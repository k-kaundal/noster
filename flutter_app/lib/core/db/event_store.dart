import 'dart:convert';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

/// The normalized, offline-first event store — the single source of truth
/// for feed content, like X/FB/Instagram's on-device cache.
///
/// Why this exists (and what it replaces):
///
/// - **Before**: feed events lived in one big JSON blob in
///   SharedPreferences (`FeedStore`), capped at 300, with no indexing.
///   Engagement (likes/reposts/zaps) was fetched per-event over relays —
///   N relay queries per screen, and every card rebuilt on every provider
///   resolution. That's the "feels like a relay demo" jank.
/// - **Now**: events are rows. Engagement is computed locally from rows.
///   A page of 50 posts needs ONE relay fetch for the posts and ZERO for
///   their counts — counts come from `event_refs` indexed rows. Rebuilds
///   are row-scoped.
///
/// Schema (normalized, X/FB-style):
///
/// - `events`     — one row per Nostr event, content-addressed by id.
/// - `event_refs` — one row per (event → referenced-event `e`-tag), the
///                  engagement index: "who liked/reposted/replied to X".
/// - `profiles`   — kind-0 metadata per pubkey (TTL'd by `fetched_at`).
///
/// Everything is `INSERT OR REPLACE` keyed on stable ids, so ingesting the
/// same event twice is a no-op — the live tail and the page fetch can both
/// write without deduping in Dart.
class EventStore {
  EventStore._();
  static final EventStore instance = EventStore._();

  static const _dbName = 'nostrfeed_events.db';
  static const _dbVersion = 1;

  Database? _db;

  Future<Database> get db async {
    final existing = _db;
    if (existing != null) return existing;
    final dir = await getApplicationDocumentsDirectory();
    _db = await openDatabase(
      '${dir.path}/$_dbName',
      version: _dbVersion,
      onCreate: _onCreate,
    );
    return _db!;
  }

  Future<void> _onCreate(Database db, int version) async {
    await db.execute('''
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        kind INTEGER NOT NULL,
        tags TEXT NOT NULL,
        content TEXT NOT NULL,
        sig TEXT NOT NULL
      )
    ''');
    // The feed query: newest N events of given kinds, optionally by author.
    await db.execute(
      'CREATE INDEX idx_events_kind_time ON events(kind, created_at DESC)',
    );
    await db.execute(
      'CREATE INDEX idx_events_author_time ON events(pubkey, created_at DESC)',
    );

    // The engagement index: each row is "event refers to target via e-tag".
    // A like/repost/reply/zap on X is the set of rows where target = X.
    await db.execute('''
      CREATE TABLE event_refs (
        target_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        kind INTEGER NOT NULL,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (target_id, event_id)
      )
    ''');
    await db.execute(
      'CREATE INDEX idx_refs_target_kind ON event_refs(target_id, kind)',
    );

    await db.execute('''
      CREATE TABLE profiles (
        pubkey TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      )
    ''');
  }

  // ── Ingest ──────────────────────────────────────────────────────────

  /// Write a batch of events + their engagement edges. Idempotent (INSERT
  /// OR REPLACE), so the page fetch and the live tail can both call it.
  Future<void> ingest(List<NostrEvent> events) async {
    if (events.isEmpty) return;
    final database = await db;
    final batch = database.batch();
    for (final e in events) {
      batch.insert(
        'events',
        {
          'id': e.id,
          'pubkey': e.pubkey,
          'created_at': e.createdAt,
          'kind': e.kind,
          'tags': jsonEncode(e.tags),
          'content': e.content,
          'sig': e.sig,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      // Index e-tag refs so engagement is a local COUNT, not a relay query.
      for (final targetId in _eTagTargets(e)) {
        batch.insert(
          'event_refs',
          {
            'target_id': targetId,
            'event_id': e.id,
            'kind': e.kind,
            'pubkey': e.pubkey,
            'created_at': e.createdAt,
          },
          conflictAlgorithm: ConflictAlgorithm.ignore,
        );
      }
    }
    await batch.commit(noResult: true);
  }

  /// The event ids this event references via `e` tags (its engagement
  /// targets — the post it likes/reposts/replies to/zaps).
  static List<String> _eTagTargets(NostrEvent e) {
    final out = <String>[];
    for (final tag in e.tags) {
      if (tag.length > 1 && tag[0] == 'e') out.add(tag[1]);
    }
    return out;
  }

  // ── Feed reads ──────────────────────────────────────────────────────

  /// The newest [limit] events of [kinds], optionally restricted to
  /// [authors], newest first, [until] paging (exclusive created_at cursor).
  Future<List<NostrEvent>> queryEvents({
    required List<int> kinds,
    int limit = 50,
    int? until,
    List<String>? authors,
  }) async {
    final database = await db;
    final where = StringBuffer('kind IN (${List.filled(kinds.length, '?').join(',')})');
    final args = <Object?>[...kinds];
    if (until != null) {
      where.write(' AND created_at < ?');
      args.add(until);
    }
    if (authors != null && authors.isNotEmpty) {
      where.write(' AND pubkey IN (${List.filled(authors.length, '?').join(',')})');
      args.addAll(authors);
    }
    final rows = await database.query(
      'events',
      where: where.toString(),
      whereArgs: args,
      orderBy: 'created_at DESC',
      limit: limit,
    );
    return rows.map(_rowToEvent).toList();
  }

  /// A single event by id, or null if we don't have it locally.
  Future<NostrEvent?> eventById(String id) async {
    final database = await db;
    final rows = await database.query(
      'events',
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return _rowToEvent(rows.first);
  }

  // ── Engagement reads (local, no relay) ──────────────────────────────

  /// Engagement counts for a set of target event ids, computed locally from
  /// the engagement index. This is what replaces N per-card relay queries:
  /// one SQL grouped count for the whole page.
  ///
  /// Only counts rows we actually have locally — combined with a batched
  /// relay fetch of engagement events into the store, the counts are as
  /// fresh as the last sync, and instant thereafter.
  Future<Map<String, EventCounts>> engagementFor(List<String> targetIds) async {
    if (targetIds.isEmpty) return {};
    final database = await db;
    final placeholders = List.filled(targetIds.length, '?').join(',');
    final rows = await database.rawQuery(
      '''
      SELECT target_id, kind, COUNT(*) AS n
      FROM event_refs
      WHERE target_id IN ($placeholders)
      GROUP BY target_id, kind
      ''',
      targetIds,
    );
    final result = <String, EventCounts>{};
    for (final row in rows) {
      final target = row['target_id'] as String;
      final kind = row['kind'] as int;
      final n = (row['n'] as num).toInt();
      final counts = result.putIfAbsent(target, EventCounts.new);
      counts.add(kind, n);
    }
    return result;
  }

  // ── Profiles ────────────────────────────────────────────────────────

  Future<NostrProfile?> profileFor(String pubkey, {Duration? maxAge}) async {
    final database = await db;
    final rows = await database.query(
      'profiles',
      where: 'pubkey = ?',
      whereArgs: [pubkey],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    final fetchedAt = rows.first['fetched_at'] as int;
    if (maxAge != null) {
      final age = DateTime.now().millisecondsSinceEpoch - fetchedAt;
      if (age > maxAge.inMilliseconds) return null; // stale — caller refetches
    }
    try {
      return NostrProfile.fromJson(
        jsonDecode(rows.first['json'] as String) as Map<String, dynamic>,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> saveProfile(String pubkey, NostrProfile profile) async {
    final database = await db;
    await database.insert(
      'profiles',
      {
        'pubkey': pubkey,
        'json': jsonEncode(profile.toJson()),
        'fetched_at': DateTime.now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // ── Maintenance (bounded storage — the "don't eat the user's disk" rule) ──

  /// Storage budget. X/FB/Instagram all bound their on-device cache and evict
  /// least-recently-used content — the app must never grow until it fills the
  /// user's storage. These are generous defaults; tuning lives here, not
  /// scattered across features.
  static const int maxEventRows = 3000; // hard row cap
  static const int maxStoreBytes = 24 * 1024 * 1024; // ~24 MB of content
  static const int maxProfiles = 1500;

  /// Current store size in bytes (events + refs + profiles), for Settings
  /// and for budget-driven pruning.
  Future<int> storeBytes() async {
    final database = await db;
    int sum(Map<String, Object?> r) =>
        (r['b'] as num? ?? 0).toInt();
    final ev = sum((await database.rawQuery(
      "SELECT COALESCE(SUM(LENGTH(content)+LENGTH(tags)+LENGTH(sig)),0) AS b FROM events",
    ))
        .first);
    final prof = sum((await database.rawQuery(
      "SELECT COALESCE(SUM(LENGTH(json)),0) AS b FROM profiles",
    ))
        .first);
    return ev + prof;
  }

  /// Row counts per table (Settings → Storage diagnostics).
  Future<({int events, int refs, int profiles})> counts() async {
    final database = await db;
    Future<int> c(String t) async =>
        Sqflite.firstIntValue(
            await database.rawQuery('SELECT COUNT(*) FROM $t')) ??
        0;
    return (
      events: await c('events'),
      refs: await c('event_refs'),
      profiles: await c('profiles'),
    );
  }

  /// Prune to the storage budget. Runs in this order, cheapest signal first:
  ///
  /// 1. **Row cap** — keep the newest [maxEventRows] events (LRU by
  ///    created_at); older ones drop with their engagement refs.
  /// 2. **Byte budget** — if the store still exceeds [maxStoreBytes], drop
  ///    the oldest 20% and re-check (bounded loop, 5 passes max).
  /// 3. **Profiles** — cap at [maxProfiles], evicting least-recently-fetched.
  ///
  /// Called fire-and-forget after ingests (never on the render path).
  Future<void> prune() async {
    final database = await db;
    await database.transaction((txn) async {
      // 1. Row cap.
      await _dropOldestBeyond(txn, maxEventRows);

      // 3. Profiles LRU cap.
      await txn.rawDelete(
        'DELETE FROM profiles WHERE pubkey NOT IN '
        '(SELECT pubkey FROM profiles ORDER BY fetched_at DESC LIMIT ?)',
        [maxProfiles],
      );
    });

    // 2. Byte budget (outside the txn — re-measures between passes).
    for (var pass = 0; pass < 5; pass++) {
      if (await storeBytes() <= maxStoreBytes) break;
      final current = await counts();
      // Drop the oldest 20% to get back under budget.
      final dropTo = (current.events * 0.8).floor();
      await database.transaction(
        (txn) => _dropOldestBeyond(txn, dropTo < 100 ? 100 : dropTo),
      );
    }
  }

  /// Delete the oldest events beyond [keep] (LRU by created_at) + their
  /// engagement refs.
  Future<void> _dropOldestBeyond(Transaction txn, int keep) async {
    final cutoff = await txn.rawQuery(
      'SELECT id FROM events ORDER BY created_at DESC LIMIT -1 OFFSET ?',
      [keep],
    );
    if (cutoff.isEmpty) return;
    final ids = cutoff.map((r) => r['id'] as String).toList();
    final placeholders = List.filled(ids.length, '?').join(',');
    await txn.delete('events', where: 'id IN ($placeholders)', whereArgs: ids);
    // Refs POINTING from dropped events; refs TO dropped events stay (they
    // still describe engagement on events we keep — cheap and small).
    await txn.delete(
      'event_refs',
      where: 'event_id IN ($placeholders)',
      whereArgs: ids,
    );
  }

  Future<void> clear() async {
    final database = await db;
    await database.delete('event_refs');
    await database.delete('events');
    await database.delete('profiles');
  }

  static NostrEvent _rowToEvent(Map<String, Object?> row) {
    return NostrEvent.fromJson({
      'id': row['id'],
      'pubkey': row['pubkey'],
      'created_at': row['created_at'],
      'kind': row['kind'],
      'tags': jsonDecode(row['tags'] as String),
      'content': row['content'],
      'sig': row['sig'],
    });
  }
}

/// Local engagement tallies for one event, built from the engagement index.
/// Mirrors `EventEngagement` but computed in SQL, not fetched per-event.
class EventCounts {
  int replies = 0;
  int reactions = 0;
  int reposts = 0;
  int zaps = 0;

  void add(int kind, int n) {
    switch (kind) {
      case 1:
      case 1111:
        replies += n;
      case 7:
        reactions += n;
      case 6:
      case 16:
        reposts += n;
      case 9735:
        zaps += n;
    }
  }

  int get total => replies + reactions + reposts + zaps;
}
