import 'dart:async';
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
/// - `events`       — one row per Nostr event, content-addressed by id.
/// - `event_refs`   — one row per (event → referenced-event `e`-tag), the
///                    engagement index: "who liked/reposted/replied to X".
/// - `profiles`     — kind-0 metadata per pubkey (TTL'd by `fetched_at`).
/// - `thread_edges` — (root_id, reply_id) per NIP-10 reply (ADR-0005 L3/L4):
///                    thread assembly is a local JOIN, not a relay query.
/// - `seen_on`      — (event_id, relay_url, seen_at) per delivery (rx-nostr
///                    `tie()` / Gossip seen-on): relay hints for backfill
///                    and outbox routing later.
///
/// Everything is `INSERT OR REPLACE` keyed on stable ids, so ingesting the
/// same event twice is a no-op — the live tail and the page fetch can both
/// write without deduping in Dart.
class EventStore {
  EventStore._();
  static final EventStore instance = EventStore._();

  static const _dbName = 'nostrfeed_events.db';
  // v2 (ADR-0005 P1): + thread_edges + seen_on.
  static const _dbVersion = 2;

  Database? _db;
  Future<Database>? _opening;

  /// Test hook: swap in an in-memory database (sqflite_common_ffi in unit
  /// tests). Tests are deterministic — no device paths, no real files.
  static Future<Database> Function()? debugOpenOverride;

  /// Test hook: close the current DB and drop the cached handle so the next
  /// [db] access re-opens (each test gets a fresh in-memory database).
  Future<void> debugReset() async {
    final existing = _db;
    _db = null;
    _opening = null;
    await existing?.close();
  }

  /// The database, opened exactly once. Concurrent first accesses SHARE one
  /// open future — the naive `if (_db == null) _db = await openDatabase()`
  /// pattern races at startup (pipeline + feed + engagement all hit [db] at
  /// once): both opens succeed, the second overwrites [_db], and the first
  /// write lands on an orphaned handle — silently LOST events (the "first
  /// event of a burst vanishes" bug the P3 pipeline test caught).
  ///
  /// Failure rule: a FAILED open must NOT be cached — otherwise one bad
  /// open (locked file at hot-restart, a transient iOS file error) poisons
  /// every later access forever (the store-wide death spiral).
  Future<Database> get db {
    final existing = _db;
    if (existing != null) return Future.value(existing);
    return _opening ??= _open().then((opened) {
      _db = opened;
      _opening = null;
      return opened;
    }, onError: (Object e) {
      _opening = null; // let the next caller retry a fresh open
      throw e;
    });
  }

  Future<Database> _open() async {
    final override = debugOpenOverride;
    if (override != null) return override();
    final dir = await getApplicationDocumentsDirectory();
    return openDatabase(
      '${dir.path}/$_dbName',
      version: _dbVersion,
      onCreate: _onCreate,
      onUpgrade: _onUpgrade,
    );
  }

  /// Schema entry points exposed for the migration test — creating a v1
  /// database by hand must not duplicate the DDL here.
  static Future<void> debugCreateV1(Database db) => instance._onCreateV1(db);
  static Future<void> debugOnUpgrade(Database db, int oldV, int newV) =>
      instance._onUpgrade(db, oldV, newV);

  Future<void> _onCreateV1(Database db) async {
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
    await db.execute(
      'CREATE INDEX idx_events_kind_time ON events(kind, created_at DESC)',
    );
    await db.execute(
      'CREATE INDEX idx_events_author_time ON events(pubkey, created_at DESC)',
    );
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

  Future<void> _onUpgrade(Database db, int oldVersion, int newVersion) async {
    if (oldVersion < 2) {
      await _createV2Tables(db);
      // Backfill thread edges from the events we already have — existing
      // installs get instant thread assembly without a refetch. Backfill is
      // best-effort: a malformed legacy row must not brick the whole
      // migration (edges re-derive on future ingests anyway).
      try {
        await _backfillThreadEdges(db);
      } catch (_) {
        // Continue — the v2 tables exist; edges fill in from here forward.
      }
    }
  }

  /// ADR-0005 L4 tables: thread assembly + seen-on tracking. All DDL is
  /// IF NOT EXISTS so the migration is idempotent (safe to re-run).
  static Future<void> _createV2Tables(Database db) async {
    // One row per (thread root ← reply) edge, from NIP-10 marked/positional
    // tags at ingest. A thread is then "all replies under root" = one
    // indexed SELECT, and replies-to-replies link up too.
    await db.execute('''
      CREATE TABLE IF NOT EXISTS thread_edges (
        root_id TEXT NOT NULL,
        reply_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (root_id, reply_id)
      )
    ''');
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_thread_root_time ON thread_edges(root_id, created_at ASC)',
    );

    // Which relays delivered which event — relay hints for thread/backfill
    // fetches (fetch the parent from where we saw the reply) and future
    // outbox routing. INSERT OR IGNORE: first sighting wins.
    await db.execute('''
      CREATE TABLE IF NOT EXISTS seen_on (
        event_id TEXT NOT NULL,
        relay_url TEXT NOT NULL,
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, relay_url)
      )
    ''');
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_seen_on_event ON seen_on(event_id)',
    );
  }

  /// Write thread edges for events stored before v2 existed.
  static Future<void> _backfillThreadEdges(Database db) async {
    final rows = await db.query(
      'events',
      columns: ['tags', 'created_at', 'id'],
      where: 'kind = 1',
    );
    final batch = db.batch();
    for (final row in rows) {
      final event = NostrEvent.fromJson({
        'id': row['id'],
        'pubkey': '',
        'created_at': row['created_at'],
        'kind': 1,
        'tags': jsonDecode(row['tags'] as String),
        'content': '',
        'sig': '',
      });
      final root = event.rootId ?? event.replyToId;
      if (root != null) {
        batch.insert(
          'thread_edges',
          {
            'root_id': root,
            'reply_id': event.id,
            'created_at': event.createdAt,
          },
          conflictAlgorithm: ConflictAlgorithm.ignore,
        );
      }
    }
    await batch.commit(noResult: true);
  }

  Future<void> _onCreate(Database db, int version) async {
    await _onCreateV1(db);
    // v2 tables (ADR-0005): thread_edges + seen_on.
    await _createV2Tables(db);
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
      // NIP-10 thread edge at ingest (ADR-0005 L3): a reply's root (marked
      // tags preferred, positional fallback) links it into its thread, so
      // thread assembly is a local JOIN — never a relay query. Replies to
      // replies link via their root too (whole-conversation assembly).
      if (e.kind == 1) {
        final root = e.rootId ?? e.replyToId;
        if (root != null) {
          batch.insert(
            'thread_edges',
            {
              'root_id': root,
              'reply_id': e.id,
              'created_at': e.createdAt,
            },
            conflictAlgorithm: ConflictAlgorithm.ignore,
          );
        }
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

  /// Feed projection page (ADR-0005 L5): the store IS the feed's source of
  /// truth. Newest-first [limit] feed-kind events, keyset-paged with
  /// [until] (created_at cursor — new posts at the top never shift a page
  /// boundary the way OFFSET does). Replies are excluded IN SQL via
  /// thread_edges (written at ingest for every kind-1 with a NIP-10
  /// parent), so reply filtering is correct no matter which path ingested
  /// the reply. Future-dated posts are clamped to now+15min for ORDERING
  /// (the "one boosted post stuck on top forever" fix) — `MIN(created_at,
  /// ?)` sorts them with the genuinely-new posts.
  Future<List<NostrEvent>> feedPage({
    required List<int> kinds,
    int limit = 50,
    int? until,
    List<String>? authors,
  }) async {
    final database = await db;
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final clampTo = now + _futureToleranceSeconds;
    final where = StringBuffer(
      'e.kind IN (${List.filled(kinds.length, '?').join(',')})'
      // NOT EXISTS = "this event is not a reply" (no thread edge points
      // from it). Only kind-1 replies carry edges, so reposts/pictures/
      // articles are untouched.
      ' AND NOT EXISTS (SELECT 1 FROM thread_edges t WHERE t.reply_id = e.id)',
    );
    final args = <Object?>[...kinds];
    if (until != null) {
      where.write(' AND e.created_at < ?');
      args.add(until);
    }
    if (authors != null && authors.isNotEmpty) {
      where.write(
          ' AND e.pubkey IN (${List.filled(authors.length, '?').join(',')})');
      args.addAll(authors);
    }
    final rows = await database.rawQuery(
      '''
      SELECT e.* FROM events e
      WHERE $where
      ORDER BY MIN(e.created_at, ?) DESC
      LIMIT ?
      ''',
      [...args, clampTo, limit],
    );
    return rows.map(_rowToEvent).toList();
  }

  /// How far in the future a post's timestamp may be before it's clamped
  /// for ordering (mirrors FeedNotifier._futureToleranceSeconds).
  static const _futureToleranceSeconds = 15 * 60;

  /// Trending candidates (ADR-0005 L5): raw engagement aggregated over a
  /// time window, straight from the engagement index. "Trending in the
  /// last 1h/24h/7d" is a WHERE clause, never a refetch — the window is
  /// just [sinceSeconds]. Ranking (anti-manipulation: unique engagers, zaps
  /// 1.5×, freshness decay, author diversity) happens in Dart via
  /// FeedRanking on the returned rows.
  Future<List<TrendingCandidate>> trendingCandidates({
    required int sinceSeconds,
    int candidateLimit = 150,
  }) async {
    final database = await db;
    final rows = await database.rawQuery(
      '''
      SELECT
        e.id AS id,
        COUNT(DISTINCT r.pubkey) AS engagers,
        SUM(CASE WHEN r.kind = 7 THEN 1 ELSE 0 END) AS reactions,
        SUM(CASE WHEN r.kind IN (6, 16) THEN 1 ELSE 0 END) AS reposts,
        SUM(CASE WHEN r.kind IN (1, 1111) THEN 1 ELSE 0 END) AS replies,
        SUM(CASE WHEN r.kind = 9735 THEN 1 ELSE 0 END) AS zaps
      FROM event_refs r
      JOIN events e ON e.id = r.target_id
      WHERE r.created_at >= ?
        AND r.kind IN (1, 6, 7, 16, 9735, 1111)
        AND e.kind IN (1, 6, 16, 20, 30023)
        AND NOT EXISTS (SELECT 1 FROM thread_edges t WHERE t.reply_id = e.id)
      GROUP BY r.target_id
      ORDER BY engagers DESC
      LIMIT ?
      ''',
      [sinceSeconds, candidateLimit],
    );
    return rows
        .map((r) => TrendingCandidate(
              eventId: r['id'] as String,
              uniqueEngagers: (r['engagers'] as num).toInt(),
              reactions: (r['reactions'] as num).toInt(),
              reposts: (r['reposts'] as num).toInt(),
              replies: (r['replies'] as num).toInt(),
              zaps: (r['zaps'] as num).toInt(),
            ))
        .toList();
  }

  /// Batch fetch by id (trending/explore resolve candidates in one query).
  /// Returned in the same order as [ids] (missing ids are skipped).
  Future<List<NostrEvent>> eventsById(List<String> ids) async {
    if (ids.isEmpty) return const [];
    final database = await db;
    final placeholders = List.filled(ids.length, '?').join(',');
    final rows = await database.query(
      'events',
      where: 'id IN ($placeholders)',
      whereArgs: ids,
    );
    final byId = {for (final r in rows) (r['id'] as String): _rowToEvent(r)};
    return [for (final id in ids) if (byId.containsKey(id)) byId[id]!];
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

  /// Kind-1 replies to [targetId] we already have locally, oldest first —
  /// via the engagement index (every reply e-tags its parent/root). Powers
  /// store-first thread loads and OPTIMISTIC replies: a just-published reply
  /// is ingested immediately, so it renders before the relay round-trip.
  Future<List<NostrEvent>> repliesFor(String targetId, {int limit = 200}) async {
    final database = await db;
    final rows = await database.rawQuery(
      '''
      SELECT e.* FROM events e
      JOIN event_refs r ON r.event_id = e.id
      WHERE r.target_id = ? AND r.kind = 1
      ORDER BY e.created_at ASC
      LIMIT ?
      ''',
      [targetId, limit],
    );
    return rows.map(_rowToEvent).toList();
  }

  // ── Threads (ADR-0005 L4/L5) ─────────────────────────────────────────

  /// All replies in the thread under [rootId], oldest first — via the
  /// thread_edges table written at ingest. Unlike [repliesFor] (which only
  /// finds replies that e-tag the target directly), this assembles the
  /// WHOLE conversation including replies-to-replies.
  Future<List<NostrEvent>> threadReplies(String rootId, {int limit = 500}) async {
    final database = await db;
    final rows = await database.rawQuery(
      '''
      SELECT e.* FROM events e
      JOIN thread_edges t ON t.reply_id = e.id
      WHERE t.root_id = ?
      ORDER BY t.created_at ASC
      LIMIT ?
      ''',
      [rootId, limit],
    );
    return rows.map(_rowToEvent).toList();
  }

  // ── Seen-on (relay provenance, ADR-0005 L4) ──────────────────────────

  /// Buffered seen-on writes: relay frames arrive one-at-a-time and a DB
  /// write per frame would thrash I/O, so sightings accumulate here and
  /// flush in one batch (every [_seenFlushInterval] or [_seenFlushAt]
  /// entries, whichever first). Fire-and-forget from the relay layer.
  final List<({String eventId, String relayUrl})> _seenBuffer = [];
  bool _seenFlushScheduled = false;
  static const _seenFlushInterval = Duration(seconds: 2);
  static const _seenFlushAt = 200;

  /// Record that [eventId] was seen on [relayUrl]. Cheap, buffered — safe
  /// to call on every inbound event (the relay layer does).
  void markSeenOn(String eventId, String relayUrl) {
    _seenBuffer.add((eventId: eventId, relayUrl: relayUrl));
    if (_seenBuffer.length >= _seenFlushAt) {
      unawaited(_flushSeenOn());
      return;
    }
    if (!_seenFlushScheduled) {
      _seenFlushScheduled = true;
      Future.delayed(_seenFlushInterval, () {
        _seenFlushScheduled = false;
        unawaited(_flushSeenOn());
      });
    }
  }

  /// Test hook: flush the seen-on buffer immediately (deterministic tests
  /// instead of waiting out the 2 s debounce timer).
  Future<void> debugFlushSeenOn() => _flushSeenOn();

  Future<void> _flushSeenOn() async {
    if (_seenBuffer.isEmpty) return;
    final pending = List.of(_seenBuffer);
    _seenBuffer.clear();
    try {
      final database = await db;
      final batch = database.batch();
      final now = DateTime.now().millisecondsSinceEpoch;
      for (final s in pending) {
        batch.insert(
          'seen_on',
          {'event_id': s.eventId, 'relay_url': s.relayUrl, 'seen_at': now},
          conflictAlgorithm: ConflictAlgorithm.ignore,
        );
      }
      await batch.commit(noResult: true);
    } catch (e) {
      // Provenance is BEST-EFFORT — a DB hiccup (locked file at hot-restart,
      // a v1 store mid-migration) must NEVER throw up through the relay
      // pipeline as an unhandled exception. The sightings drop; the next
      // flush retries fresh. debugPrint, don't crash.
      assert(() {
        // ignore: avoid_print
        print('EventStore._flushSeenOn dropped ${pending.length} sightings: $e');
        return true;
      }());
    }
  }

  /// The relays we've seen [eventId] on (most recent first) — relay hints
  /// for fetching it/its thread from where it actually lives.
  Future<List<String>> seenOnRelays(String eventId, {int limit = 5}) async {
    final database = await db;
    final rows = await database.query(
      'seen_on',
      columns: ['relay_url'],
      where: 'event_id = ?',
      whereArgs: [eventId],
      orderBy: 'seen_at DESC',
      limit: limit,
    );
    return rows.map((r) => r['relay_url'] as String).toList();
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
    await txn.delete(
      'seen_on',
      where: 'event_id IN ($placeholders)',
      whereArgs: ids,
    );
    await txn.delete(
      'thread_edges',
      where: 'reply_id IN ($placeholders)',
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

/// One trending candidate: a post + its deduped window engagement, from
/// [EventStore.trendingCandidates]. Maps 1:1 onto EventEngagement for
/// FeedRanking.
class TrendingCandidate {
  final String eventId;
  final int uniqueEngagers;
  final int reactions;
  final int reposts;
  final int replies;
  final int zaps;

  const TrendingCandidate({
    required this.eventId,
    required this.uniqueEngagers,
    required this.reactions,
    required this.reposts,
    required this.replies,
    required this.zaps,
  });
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
