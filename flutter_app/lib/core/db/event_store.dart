import 'dart:async';
import 'dart:convert';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/filter.dart';
import 'package:nostrfeed_mobile/core/nostr/kinds.dart';
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
/// - `tags`         — (event_id, name, first-value) per single-letter tag
///                    (ADR-0007 v3 — NIP-01's indexing contract; `#x`
///                    filters are indexed lookups, not JSON decodes).
/// - `deletions`    — NIP-09 audit (ADR-0007 v3): reject late copies of
///                    author-deleted events.
/// - `event_refs`   — one row per (event → referenced-event `e`-tag), the
///                    engagement index: "who liked/reposted/replied to X".
/// - `profiles`     — kind-0 metadata per pubkey (TTL'd by `fetched_at`).
/// - `thread_edges` — (root_id, reply_id) per NIP-10 reply (ADR-0005 L3/L4):
///                    thread assembly is a local JOIN, not a relay query.
/// - `seen_on`      — (event_id, relay_url, seen_at) per delivery (rx-nostr
///                    `tie()` / Gossip seen-on): relay hints for backfill
///                    and outbox routing later.
///
/// Ingest enforces the NIP-01 lifecycle (ADR-0007 v3): ephemeral kinds are
/// never stored; replaceable (0, 3, 10000–19999) and addressable
/// (30000–39999) kinds keep only the newest version per identity; kind-5
/// deletions remove same-author targets and block their late re-arrival.
/// Everything else is `INSERT OR REPLACE` keyed on stable ids, so ingesting
/// the same event twice is a no-op — the live tail and the page fetch can
/// both write without deduping in Dart.
class EventStore {
  EventStore._();
  static final EventStore instance = EventStore._();

  static const _dbName = 'nostrfeed_events.db';
  // v2 (ADR-0005 P1): + thread_edges + seen_on.
  // v3 (ADR-0007 P1): + tags (generalized single-letter index) + deletions
  //                   (NIP-09 audit) + NIP-01 lifecycle enforcement.
  static const _dbVersion = 3;

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
    return _opening ??= _open().then(
      (opened) {
        _db = opened;
        _opening = null;
        return opened;
      },
      onError: (Object e) {
        _opening = null; // let the next caller retry a fresh open
        throw e;
      },
    );
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
    if (oldVersion < 3) {
      await _createV3Tables(db);
      // Backfill the generalized tag index from stored events so existing
      // installs can answer #tag queries immediately. Best-effort, like the
      // v2 backfill: a malformed row must not brick the migration.
      try {
        await _backfillTags(db);
      } catch (_) {
        // tags re-derive on future ingests.
      }
    }
  }

  /// ADR-0007 Phase 1 tables: the generalized single-letter tag index
  /// (NIP-01's indexing contract — replaces the e-tag-only view for
  /// FILTERING; `event_refs` stays as the engagement projection) and the
  /// NIP-09 deletion audit. All DDL IF NOT EXISTS → idempotent.
  static Future<void> _createV3Tables(Database db) async {
    // One row per (event, tag-name, first-value) for every single-letter
    // tag. `#e`/`#p`/`#a`/`#t`/`#d`/`#h`/`#q`… queries become indexed
    // lookups here instead of JSON-decoding every row's tags.
    await db.execute('''
      CREATE TABLE IF NOT EXISTS tags (
        event_id TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (event_id, name, value)
      )
    ''');
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_tags_name_value ON tags(name, value, event_id)',
    );

    // NIP-09 audit: (deleted target, who deleted it, when). Lets ingest
    // REJECT a late-arriving copy of an already-deleted event (relays
    // deliver out of order — the deletion can land before the event).
    await db.execute('''
      CREATE TABLE IF NOT EXISTS deletions (
        target_id TEXT NOT NULL,
        deleted_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (target_id, deleted_by)
      )
    ''');
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_deletions_target ON deletions(target_id)',
    );

    // since/until scans with no better index fall back to created_at.
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC)',
    );
  }

  /// Backfill `tags` from events stored before v3 existed.
  static Future<void> _backfillTags(Database db) async {
    final rows = await db.query('events', columns: ['id', 'tags']);
    final batch = db.batch();
    for (final row in rows) {
      final id = row['id'] as String;
      List<dynamic> decoded;
      try {
        decoded = jsonDecode(row['tags'] as String) as List<dynamic>;
      } catch (_) {
        continue;
      }
      for (final entry in _singleLetterTagRows(decoded)) {
        batch.insert('tags', {
          'event_id': id,
          'name': entry.$1,
          'value': entry.$2,
        }, conflictAlgorithm: ConflictAlgorithm.ignore);
      }
    }
    await batch.commit(noResult: true);
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
        batch.insert('thread_edges', {
          'root_id': root,
          'reply_id': event.id,
          'created_at': event.createdAt,
        }, conflictAlgorithm: ConflictAlgorithm.ignore);
      }
    }
    await batch.commit(noResult: true);
  }

  Future<void> _onCreate(Database db, int version) async {
    await _onCreateV1(db);
    // v2 tables (ADR-0005): thread_edges + seen_on.
    await _createV2Tables(db);
    // v3 tables (ADR-0007): tags + deletions + time index.
    await _createV3Tables(db);
  }

  // ── Ingest (NIP-01 lifecycle — ADR-0007 Phase 1) ──────────────────────

  /// Write a batch of events with full NIP-01 storage semantics:
  ///
  /// - **Ephemeral** (20000–29999): never persisted (forwarded live by the
  ///   relay layer; the store stays clean).
  /// - **Replaceable** (0, 3, 10000–19999): newest per (pubkey, kind) wins;
  ///   an older/stale version is dropped, a newer one replaces.
  /// - **Addressable** (30000–39999): newest per (pubkey, kind, d-tag) wins.
  /// - **NIP-09 deletion** (kind 5): deletes referenced same-author targets
  ///   and records the deletion so a late copy is rejected.
  /// - **NIP-01 tag indexing**: every single-letter tag's first value lands
  ///   in `tags` for `#x` filtering.
  ///
  /// Idempotent, so the page fetch and the live tail can both call it.
  ///
  /// Two paths, chosen per event kind, so a big engagement sync doesn't
  /// hold the DB lock for seconds (the "database has been locked" spam):
  ///
  /// - **Fast path (regular kinds)** — posts, reactions, reposts, zap
  ///   receipts, chat… ~95% of volume. No lifecycle reads needed (no
  ///   replaceable/addressable/deletion checks): writes go through ONE
  ///   `batch()` per chunk, committed in small pieces so the lock breathes
  ///   between chunks and other reads/writes interleave.
  /// - **Lifecycle path (replaceable / addressable / deletion)** — per-event
  ///   transactions, because newest-wins and delete semantics need read-
  ///   modify-write. These are a small minority of events.
  Future<void> ingest(List<NostrEvent> events) async {
    if (events.isEmpty) return;
    Database database;
    try {
      database = await db;
    } catch (e) {
      if (e is DatabaseException && '$e'.contains('database_closed')) return;
      rethrow;
    }

    final fast = <NostrEvent>[];
    final lifecycle = <NostrEvent>[];
    for (final e in events) {
      if (NostrKinds.isEphemeral(e.kind)) continue; // never stored
      final needsLifecycle =
          NostrKinds.isReplaceable(e.kind) ||
          NostrKinds.isAddressable(e.kind) ||
          e.kind == NostrKinds.deletion;
      (needsLifecycle ? lifecycle : fast).add(e);
    }

    // Fast path: chunked batches. Each chunk is one short transaction —
    // long enough to be efficient, short enough that the lock breathes
    // between chunks and the UI never stalls behind a 1000-event sync.
    const chunkSize = 50;
    for (var i = 0; i < fast.length; i += chunkSize) {
      final chunk = fast.sublist(
        i,
        i + chunkSize > fast.length ? fast.length : i + chunkSize,
      );
      try {
        await database.transaction((txn) async {
          // NIP-09 late-copy rejection, BATCHED: load the deletion rows for
          // this chunk's ids in ONE query, then filter in Dart — a kind-1
          // post arriving after its author deleted it must never be stored,
          // but the check must not cost a round-trip per event.
          final ids = chunk.map((e) => e.id).toList();
          final deleted = <String>{};
          final placeholders = List.filled(ids.length, '?').join(',');
          final delRows = await txn.query(
            'deletions',
            columns: ['target_id'],
            where: 'target_id IN ($placeholders)',
            whereArgs: ids,
          );
          for (final r in delRows) {
            deleted.add(r['target_id'] as String);
          }
          final batch = txn.batch();
          for (final e in chunk) {
            if (deleted.contains(e.id)) continue;
            _queueFastEvent(batch, e);
          }
          await batch.commit(noResult: true);
        });
      } catch (err) {
        if (err is DatabaseException && '$err'.contains('database_closed')) {
          return;
        }
        assert(() {
          // ignore: avoid_print
          print('EventStore.ingest fast chunk failed: $err');
          return true;
        }());
      }
    }

    // Lifecycle path: per-event transactions (read-modify-write).
    for (final e in lifecycle) {
      try {
        await database.transaction((txn) => _ingestOne(txn, e));
      } catch (err) {
        if (err is DatabaseException && '$err'.contains('database_closed')) {
          return;
        }
        assert(() {
          // ignore: avoid_print
          print('EventStore.ingest skipped event ${e.id}: $err');
          return true;
        }());
      }
    }
  }

  /// Queue a regular-kind event's writes into a [Batch] — no reads needed:
  /// the row + tags + engagement refs + thread edge, all `INSERT OR REPLACE`
  /// / `INSERT OR IGNORE` keyed on stable ids. Deletions don't apply
  /// (regular kinds can't be deletion targets of the lifecycle path's own
  /// author-scoped check in the same ingest — a rare race, and the
  /// `deletions` table is consulted on the QUERY side for those).
  void _queueFastEvent(Batch batch, NostrEvent e) {
    batch.insert('events', {
      'id': e.id,
      'pubkey': e.pubkey,
      'created_at': e.createdAt,
      'kind': e.kind,
      'tags': jsonEncode(e.tags),
      'content': e.content,
      'sig': e.sig,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
    // Rebuild the tag index for this id (replace, so stale tags never linger).
    batch.delete('tags', where: 'event_id = ?', whereArgs: [e.id]);
    for (final entry in _singleLetterTagRows(e.tags)) {
      batch.insert('tags', {
        'event_id': e.id,
        'name': entry.$1,
        'value': entry.$2,
      }, conflictAlgorithm: ConflictAlgorithm.ignore);
    }
    // Engagement index (e-tag refs).
    for (final targetId in _eTagTargets(e)) {
      batch.insert('event_refs', {
        'target_id': targetId,
        'event_id': e.id,
        'kind': e.kind,
        'pubkey': e.pubkey,
        'created_at': e.createdAt,
      }, conflictAlgorithm: ConflictAlgorithm.ignore);
    }
    // NIP-10 thread edge.
    if (e.kind == 1) {
      final root = e.rootId ?? e.replyToId;
      if (root != null) {
        batch.insert('thread_edges', {
          'root_id': root,
          'reply_id': e.id,
          'created_at': e.createdAt,
        }, conflictAlgorithm: ConflictAlgorithm.ignore);
      }
    }
  }

  Future<void> _ingestOne(Transaction txn, NostrEvent e) async {
    final kind = e.kind;

    // Ephemeral: relays MUST NOT store these. Forwarding is the relay
    // layer's job; nothing reaches disk here.
    if (NostrKinds.isEphemeral(kind)) return;

    // NIP-09 deletion request: process it, and keep the deletion event
    // itself (it's a regular kind — relays store it).
    if (kind == NostrKinds.deletion) {
      await _applyDeletion(txn, e);
    }

    // Replaceable / addressable: only the newest version survives. Tie-break
    // per NIP-01: same created_at → lowest id wins.
    if (NostrKinds.isReplaceable(kind)) {
      final stale = await _isStaleReplaceable(
        txn,
        where: 'pubkey = ? AND kind = ?',
        args: [e.pubkey, kind],
        event: e,
      );
      if (stale) return;
      await txn.delete(
        'events',
        where: 'pubkey = ? AND kind = ? AND id != ?',
        whereArgs: [e.pubkey, kind, e.id],
      );
    } else if (NostrKinds.isAddressable(kind)) {
      final d = e.dTag ?? '';
      // Addressable staleness needs an EXACT d-tag match, which SQL can't do
      // on the JSON-serialized tags column — compare in Dart (same approach
      // as _deleteSupersededAddressable). Using a LIKE probe with `=` here
      // silently matched NOTHING before, letting a late older version wipe
      // the newer stored one (articles, lists, communities…).
      final stale = await _isStaleAddressable(txn, e, d);
      if (stale) return;
      // Remove superseded versions of the same address.
      await _deleteSupersededAddressable(txn, e, d);
    }

    // NIP-09: a late-arriving event already deleted by its author is
    // rejected (the deletion landed first — relays deliver out of order).
    if (await _isDeleted(txn, e.id, e.pubkey)) return;

    await txn.insert('events', {
      'id': e.id,
      'pubkey': e.pubkey,
      'created_at': e.createdAt,
      'kind': e.kind,
      'tags': jsonEncode(e.tags),
      'content': e.content,
      'sig': e.sig,
    }, conflictAlgorithm: ConflictAlgorithm.replace);

    // Generalized single-letter tag index (NIP-01 contract). Replace on
    // re-ingest so stale tags never linger.
    await txn.delete('tags', where: 'event_id = ?', whereArgs: [e.id]);
    final tagBatch = <Map<String, Object?>>[
      for (final entry in _singleLetterTagRows(e.tags))
        {'event_id': e.id, 'name': entry.$1, 'value': entry.$2},
    ];
    for (final row in tagBatch) {
      await txn.insert(
        'tags',
        row,
        conflictAlgorithm: ConflictAlgorithm.ignore,
      );
    }

    // Index e-tag refs so engagement is a local COUNT, not a relay query.
    for (final targetId in _eTagTargets(e)) {
      await txn.insert('event_refs', {
        'target_id': targetId,
        'event_id': e.id,
        'kind': e.kind,
        'pubkey': e.pubkey,
        'created_at': e.createdAt,
      }, conflictAlgorithm: ConflictAlgorithm.ignore);
    }

    // NIP-10 thread edge at ingest (ADR-0005 L3).
    if (kind == 1) {
      final root = e.rootId ?? e.replyToId;
      if (root != null) {
        await txn.insert('thread_edges', {
          'root_id': root,
          'reply_id': e.id,
          'created_at': e.createdAt,
        }, conflictAlgorithm: ConflictAlgorithm.ignore);
      }
    }
  }

  /// Is there already a NEWER version of this replaceable event stored?
  /// [where]/[args] select the version row(s) for the same identity
  /// (pubkey+kind).
  Future<bool> _isStaleReplaceable(
    Transaction txn, {
    required String where,
    required List<Object?> args,
    required NostrEvent event,
  }) async {
    final rows = await txn.query(
      'events',
      columns: ['created_at', 'id'],
      where: where,
      whereArgs: args,
    );
    for (final row in rows) {
      final existingTs = row['created_at'] as int;
      final existingId = row['id'] as String;
      if (existingTs > event.createdAt) return true; // newer already stored
      // Same timestamp → NIP-01 tie-break: lowest id wins, so an incoming
      // HIGHER id is stale.
      if (existingTs == event.createdAt && existingId.compareTo(event.id) < 0) {
        return true;
      }
    }
    return false;
  }

  /// Addressable staleness: true when a stored event with the SAME
  /// (pubkey, kind, d) is newer than [incoming] (or ties with a lower id).
  /// d-tags are compared in Dart — the tags column is JSON.
  Future<bool> _isStaleAddressable(
    Transaction txn,
    NostrEvent incoming,
    String d,
  ) async {
    final candidates = await txn.query(
      'events',
      columns: ['id', 'tags', 'created_at'],
      where: 'pubkey = ? AND kind = ? AND id != ?',
      whereArgs: [incoming.pubkey, incoming.kind, incoming.id],
    );
    for (final row in candidates) {
      if (_rowDTag(row['tags'] as String) != d) continue;
      final existingTs = row['created_at'] as int;
      final existingId = row['id'] as String;
      if (existingTs > incoming.createdAt) return true;
      if (existingTs == incoming.createdAt &&
          existingId.compareTo(incoming.id) < 0) {
        return true;
      }
    }
    return false;
  }

  /// The d-tag value in a serialized tags JSON, or '' (Dart-side helper for
  /// addressable identity — SQL can't probe inside the JSON portably).
  static String _rowDTag(String tagsJson) {
    List<dynamic> decoded;
    try {
      decoded = jsonDecode(tagsJson) as List<dynamic>;
    } catch (_) {
      return '';
    }
    for (final t in decoded) {
      if (t is List && t.length > 1 && t[0] == 'd') return '${t[1]}';
    }
    return '';
  }

  /// Delete superseded versions of the same address (pubkey, kind, d).
  /// JSON tags are decoded in Dart for an exact d-tag compare — the SQL
  /// LIKE probe only narrows candidates.
  Future<void> _deleteSupersededAddressable(
    Transaction txn,
    NostrEvent incoming,
    String d,
  ) async {
    final candidates = await txn.query(
      'events',
      columns: ['id', 'tags', 'created_at'],
      where: 'pubkey = ? AND kind = ? AND id != ?',
      whereArgs: [incoming.pubkey, incoming.kind, incoming.id],
    );
    for (final row in candidates) {
      if (_rowDTag(row['tags'] as String) == d) {
        await txn.delete(
          'events',
          where: 'id = ?',
          whereArgs: [row['id'] as String],
        );
      }
    }
  }

  /// Has this event id already been deleted by [pubkey] (NIP-09)?
  Future<bool> _isDeleted(
    Transaction txn,
    String eventId,
    String pubkey,
  ) async {
    final rows = await txn.query(
      'deletions',
      columns: ['target_id'],
      where: 'target_id = ? AND deleted_by = ?',
      whereArgs: [eventId, pubkey],
      limit: 1,
    );
    return rows.isNotEmpty;
  }

  /// Apply a NIP-09 deletion event: delete referenced targets the author
  /// owns, and record the deletion so late copies are rejected. NIP-09:
  /// relays SHOULD only honor deletions where the deletion author equals
  /// the target author. `a` tags address replaceable/addressable events.
  Future<void> _applyDeletion(Transaction txn, NostrEvent deletion) async {
    final now = deletion.createdAt;
    // e tags: plain event ids.
    for (final targetId in _eTagTargets(deletion)) {
      // Only delete if we hold the target AND it's by the same author.
      final held = await txn.query(
        'events',
        columns: ['pubkey'],
        where: 'id = ?',
        whereArgs: [targetId],
        limit: 1,
      );
      if (held.isNotEmpty && held.first['pubkey'] == deletion.pubkey) {
        await _deleteEventCascade(txn, targetId);
      }
      // Record regardless (covers late arrivals of the target).
      await txn.insert('deletions', {
        'target_id': targetId,
        'deleted_by': deletion.pubkey,
        'created_at': now,
      }, conflictAlgorithm: ConflictAlgorithm.ignore);
    }
    // a tags: kind:pubkey:d — delete that author's matching versions.
    for (final a in deletion.getTags('a')) {
      final parts = a.split(':');
      if (parts.length < 2) continue;
      final kind = int.tryParse(parts[0]);
      final author = parts[1];
      if (kind == null || author != deletion.pubkey) continue;
      final d = parts.length > 2 ? parts.sublist(2).join(':') : '';
      final candidates = await txn.query(
        'events',
        columns: ['id', 'tags'],
        where: 'pubkey = ? AND kind = ?',
        whereArgs: [author, kind],
      );
      for (final row in candidates) {
        if (d.isEmpty) {
          await _deleteEventCascade(txn, row['id'] as String);
          continue;
        }
        List<dynamic> decoded;
        try {
          decoded = jsonDecode(row['tags'] as String) as List<dynamic>;
        } catch (_) {
          continue;
        }
        var rowD = '';
        for (final t in decoded) {
          if (t is List && t.length > 1 && t[0] == 'd') {
            rowD = '${t[1]}';
            break;
          }
        }
        if (rowD == d) await _deleteEventCascade(txn, row['id'] as String);
      }
      await txn.insert('deletions', {
        'target_id': a,
        'deleted_by': author,
        'created_at': now,
      }, conflictAlgorithm: ConflictAlgorithm.ignore);
    }
  }

  /// Delete an event and everything that points from/to it.
  Future<void> _deleteEventCascade(Transaction txn, String eventId) async {
    await txn.delete('events', where: 'id = ?', whereArgs: [eventId]);
    await txn.delete('tags', where: 'event_id = ?', whereArgs: [eventId]);
    await txn.delete('event_refs', where: 'event_id = ?', whereArgs: [eventId]);
    await txn.delete(
      'thread_edges',
      where: 'reply_id = ?',
      whereArgs: [eventId],
    );
    await txn.delete('seen_on', where: 'event_id = ?', whereArgs: [eventId]);
  }

  /// The (name, first-value) pairs of every single-letter tag — NIP-01's
  /// indexing contract. Non-single-letter tags (e.g. `expiration`,
  /// `subject`) are NOT indexed (they're not part of the `#x` contract).
  ///
  /// Canonical form: hex tags (`e`/`p`) and hashtags (`t`) are stored
  /// LOWERCASED so queries match case-insensitively the way real relays
  /// answer them (`#Nostr` ≡ `#nostr`, hex is always lowercase on the
  /// wire). Every other tag keeps its exact value.
  static List<(String, String)> _singleLetterTagRows(List<dynamic> tags) {
    final out = <(String, String)>[];
    for (final t in tags) {
      if (t is List && t.length > 1 && t[0] is String) {
        final name = t[0] as String;
        if (name.length == 1 && RegExp(r'^[a-zA-Z]$').hasMatch(name)) {
          final raw = '${t[1]}';
          final value = (name == 'e' || name == 'p' || name == 't')
              ? raw.toLowerCase()
              : raw;
          out.add((name, value));
        }
      }
    }
    return out;
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

  /// Generic NIP-01 query engine (ADR-0007 §3.3) — the local relay's
  /// "initial query" planner, shared with every feature that needs
  /// filter-accurate reads.
  ///
  /// Per filter: pick the ONE most-selective index path (ids > #tags >
  /// authors > kinds > time), bound the scan with since/until, then apply
  /// the full [CompiledFilter] to each candidate before keeping it (the
  /// same "scan one index, apply the rest" rule strfry uses). Results are
  /// merged newest-first (NIP-01: ties → lowest id first) and bounded by
  /// the smallest specified `limit`.
  ///
  /// NIP-40: expired events are excluded via the `expiration` tag marker.
  /// Replaceable/addressable dedup is already enforced at ingest, so one
  /// version per identity exists here.
  Future<List<NostrEvent>> queryByFilters(
    List<NostrFilter> filters, {
    int defaultLimit = 50,
  }) async {
    if (filters.isEmpty) return [];
    final database = await db;
    final compiled = filters.map(CompiledFilter.from).toList();
    final nowSec = DateTime.now().millisecondsSinceEpoch ~/ 1000;

    // NIP-01 limit semantics: a filter's `limit` bounds ITS OWN initial
    // query, and the REQ result is the OR (union) of its filters — so each
    // filter scans with its own bound (`limit: 0` = "no stored events for
    // this filter", contributes nothing) and the union is naturally bounded
    // by the sum of the per-filter bounds. No global cap: a broad filter is
    // never starved by a tight companion, and a lone tight filter caps its
    // own result exactly as a relay would.
    final merged = <String, NostrEvent>{};
    for (var i = 0; i < filters.length; i++) {
      final filter = filters[i];
      final compiledFilter = compiled[i];
      if (compiledFilter.isDead) continue;
      if (filter.limit == 0) continue; // live-only filter
      final filterCap = filter.limit ?? defaultLimit;

      final rows = await _scanCandidates(database, filter, filterCap, nowSec);
      for (final row in rows) {
        final event = _rowToEvent(row);
        if (event.isExpired) continue; // NIP-40 belt-and-braces
        if (!compiledFilter.matches(event)) continue;
        merged[event.id] = event;
      }
    }

    final out = merged.values.toList()
      ..sort((a, b) {
        final byTime = b.createdAt.compareTo(a.createdAt);
        return byTime != 0 ? byTime : a.id.compareTo(b.id); // NIP-01 tie
      });
    return out;
  }

  /// Scan the best index for [filter] and return candidate rows (bounded).
  Future<List<Map<String, Object?>>> _scanCandidates(
    Database database,
    NostrFilter filter,
    int cap,
    int nowSec,
  ) async {
    final args = <Object?>[];
    final where = StringBuffer('1=1');

    // NIP-40: exclude rows carrying an already-past expiration tag.
    // (expiration is not a single-letter tag, so it's not in `tags` —
    // probe the serialized tags JSON; candidates are re-checked in Dart.)
    void timeBounds() {
      if (filter.since != null) {
        where.write(' AND created_at >= ?');
        args.add(filter.since);
      }
      if (filter.until != null) {
        where.write(' AND created_at <= ?');
        args.add(filter.until);
      }
    }

    // 1. ids — primary-key lookups, most selective.
    if (filter.ids != null && filter.ids!.isNotEmpty) {
      final ids = filter.ids!
          .where((v) => v.length == 64)
          .map((v) => v.toLowerCase());
      if (ids.isEmpty) return const [];
      where.write(' AND id IN (${List.filled(ids.length, '?').join(',')})');
      args.addAll(ids);
      timeBounds();
      return database.query(
        'events',
        where: where.toString(),
        whereArgs: args,
        limit: cap,
      );
    }

    // 2. Single best #tag (the one with fewest values) → tags index.
    final tagFilters = filter.tagFilters;
    if (tagFilters != null && tagFilters.isNotEmpty) {
      final best = tagFilters.entries.reduce(
        (a, b) => a.value.length <= b.value.length ? a : b,
      );
      if (best.value.isEmpty) return const [];
      where.write(
        ' AND id IN (SELECT event_id FROM tags WHERE name = ? '
        'AND value IN (${List.filled(best.value.length, '?').join(',')}))',
      );
      args.add(best.key);
      // NIP-01 says nothing about case, but relays in practice match `#t`
      // (hashtags) case-INSENSITIVELY (a `#Nostr` post answers `#nostr`) and
      // `#e`/`#p` are hex (always lowercase on the wire). Match that: hex
      // tags + `t` compare lowercased; every other tag stays exact.
      final caseInsensitive =
          best.key == 'e' || best.key == 'p' || best.key == 't';
      args.addAll(
        caseInsensitive ? best.value.map((v) => v.toLowerCase()) : best.value,
      );
      // Narrow further with kinds if present (cheap, uses the join).
      if (filter.kinds != null && filter.kinds!.isNotEmpty) {
        where.write(
          ' AND kind IN (${List.filled(filter.kinds!.length, '?').join(',')})',
        );
        args.addAll(filter.kinds!);
      }
      timeBounds();
      return database.query(
        'events',
        where: where.toString(),
        whereArgs: args,
        orderBy: 'created_at DESC',
        limit: cap,
      );
    }

    // 3. authors (+kinds) → idx_events_author_time.
    if (filter.authors != null && filter.authors!.isNotEmpty) {
      final authors = filter.authors!
          .where((v) => v.length == 64)
          .map((v) => v.toLowerCase());
      if (authors.isEmpty) return const [];
      where.write(
        ' AND pubkey IN (${List.filled(authors.length, '?').join(',')})',
      );
      args.addAll(authors);
      if (filter.kinds != null && filter.kinds!.isNotEmpty) {
        where.write(
          ' AND kind IN (${List.filled(filter.kinds!.length, '?').join(',')})',
        );
        args.addAll(filter.kinds!);
      }
      timeBounds();
      return database.query(
        'events',
        where: where.toString(),
        whereArgs: args,
        orderBy: 'created_at DESC',
        limit: cap,
      );
    }

    // 4. kinds only → idx_events_kind_time. 5. else time scan.
    if (filter.kinds != null && filter.kinds!.isNotEmpty) {
      where.write(
        ' AND kind IN (${List.filled(filter.kinds!.length, '?').join(',')})',
      );
      args.addAll(filter.kinds!);
    }
    timeBounds();
    return database.query(
      'events',
      where: where.toString(),
      whereArgs: args,
      orderBy: 'created_at DESC',
      limit: cap,
    );
  }

  /// The (created_at, id) record set a NIP-77 sync needs — cheap (no
  /// content/tags/sig decoded), sorted by (created_at, id) per the
  /// negentropy record ordering. Built from a [NostrFilter] subset
  /// (ids/authors/kinds/since/until — tag filters are not part of the sync
  /// scope, matching strfry's NEG filter handling).
  Future<List<({int timestamp, String id})>> syncRecords(
    NostrFilter filter,
  ) async {
    final database = await db;
    final where = StringBuffer('1=1');
    final args = <Object?>[];
    if (filter.ids != null && filter.ids!.isNotEmpty) {
      final ids = filter.ids!
          .where((v) => v.length == 64)
          .map((v) => v.toLowerCase());
      if (ids.isEmpty) return const [];
      where.write(' AND id IN (${List.filled(ids.length, '?').join(',')})');
      args.addAll(ids);
    }
    if (filter.authors != null && filter.authors!.isNotEmpty) {
      final authors = filter.authors!
          .where((v) => v.length == 64)
          .map((v) => v.toLowerCase());
      if (authors.isEmpty) return const [];
      where.write(
        ' AND pubkey IN (${List.filled(authors.length, '?').join(',')})',
      );
      args.addAll(authors);
    }
    if (filter.kinds != null && filter.kinds!.isNotEmpty) {
      where.write(
        ' AND kind IN (${List.filled(filter.kinds!.length, '?').join(',')})',
      );
      args.addAll(filter.kinds!);
    }
    if (filter.since != null) {
      where.write(' AND created_at >= ?');
      args.add(filter.since);
    }
    if (filter.until != null) {
      where.write(' AND created_at <= ?');
      args.add(filter.until);
    }
    final rows = await database.rawQuery(
      'SELECT created_at AS ts, id FROM events WHERE $where ORDER BY ts ASC, id ASC',
      args,
    );
    return rows
        .map((r) => (timestamp: r['ts'] as int, id: r['id'] as String))
        .toList();
  }

  /// The newest [limit] events of [kinds], optionally restricted to
  /// [authors], newest first, [until] paging (exclusive created_at cursor).
  Future<List<NostrEvent>> queryEvents({
    required List<int> kinds,
    int limit = 50,
    int? until,
    List<String>? authors,
  }) async {
    final database = await db;
    final where = StringBuffer(
      'kind IN (${List.filled(kinds.length, '?').join(',')})',
    );
    final args = <Object?>[...kinds];
    if (until != null) {
      where.write(' AND created_at < ?');
      args.add(until);
    }
    if (authors != null && authors.isNotEmpty) {
      where.write(
        ' AND pubkey IN (${List.filled(authors.length, '?').join(',')})',
      );
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
        ' AND e.pubkey IN (${List.filled(authors.length, '?').join(',')})',
      );
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
        .map(
          (r) => TrendingCandidate(
            eventId: r['id'] as String,
            uniqueEngagers: (r['engagers'] as num).toInt(),
            reactions: (r['reactions'] as num).toInt(),
            reposts: (r['reposts'] as num).toInt(),
            replies: (r['replies'] as num).toInt(),
            zaps: (r['zaps'] as num).toInt(),
          ),
        )
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
    return [
      for (final id in ids)
        if (byId.containsKey(id)) byId[id]!,
    ];
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
    final rows = await database.rawQuery('''
      SELECT target_id, kind, COUNT(*) AS n
      FROM event_refs
      WHERE target_id IN ($placeholders)
      GROUP BY target_id, kind
      ''', targetIds);
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

  /// The current user's like/repost state for [targetIds], from the local
  /// engagement index — ONE grouped SQL query for a whole page instead of
  /// each PostCard firing its own relay query (the "every card does its own
  /// fetchUserInteractions" jank). Only knows engagement we ingested (the
  /// engagement batch brings the user's own kind 6/7/16 too); a card with
  /// no local row just renders un-liked until the batch lands.
  Future<Map<String, ({bool liked, bool reposted})>> userInteractionsFor(
    String userPubkey,
    List<String> targetIds,
  ) async {
    if (targetIds.isEmpty || userPubkey.isEmpty) return {};
    final database = await db;
    final placeholders = List.filled(targetIds.length, '?').join(',');
    final rows = await database.rawQuery(
      '''
      SELECT target_id, kind FROM event_refs
      WHERE pubkey = ? AND kind IN (6, 7, 16) AND target_id IN ($placeholders)
      ''',
      [userPubkey, ...targetIds],
    );
    final result = <String, ({bool liked, bool reposted})>{};
    for (final row in rows) {
      final target = row['target_id'] as String;
      final kind = row['kind'] as int;
      final existing = result[target] ?? (liked: false, reposted: false);
      result[target] = (
        liked: existing.liked || kind == 7,
        reposted: existing.reposted || kind == 6 || kind == 16,
      );
    }
    return result;
  }

  /// Kind-1 replies to [targetId] we already have locally, oldest first —
  /// via the engagement index (every reply e-tags its parent/root). Powers
  /// store-first thread loads and OPTIMISTIC replies: a just-published reply
  /// is ingested immediately, so it renders before the relay round-trip.
  Future<List<NostrEvent>> repliesFor(
    String targetId, {
    int limit = 200,
  }) async {
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
  Future<List<NostrEvent>> threadReplies(
    String rootId, {
    int limit = 500,
  }) async {
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
        batch.insert('seen_on', {
          'event_id': s.eventId,
          'relay_url': s.relayUrl,
          'seen_at': now,
        }, conflictAlgorithm: ConflictAlgorithm.ignore);
      }
      await batch.commit(noResult: true);
    } catch (e) {
      // Provenance is BEST-EFFORT — a DB hiccup (locked file at hot-restart,
      // a v1 store mid-migration) must NEVER throw up through the relay
      // pipeline as an unhandled exception. The sightings drop; the next
      // flush retries fresh. debugPrint, don't crash.
      assert(() {
        // ignore: avoid_print
        print(
          'EventStore._flushSeenOn dropped ${pending.length} sightings: $e',
        );
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
    final row = await profileRowFor(pubkey);
    if (row == null) return null;
    if (maxAge != null) {
      final age = DateTime.now().millisecondsSinceEpoch - row.fetchedAtMs;
      if (age > maxAge.inMilliseconds) return null; // stale — caller refetches
    }
    return row.profile;
  }

  /// The stored profile + its fetch timestamp (ms), or null. Used by the
  /// persistent profile cache (stale-while-revalidate needs the age).
  Future<({NostrProfile profile, int fetchedAtMs})?> profileRowFor(
    String pubkey,
  ) async {
    final database = await db;
    final rows = await database.query(
      'profiles',
      where: 'pubkey = ?',
      whereArgs: [pubkey],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    try {
      return (
        profile: NostrProfile.fromJson(
          jsonDecode(rows.first['json'] as String) as Map<String, dynamic>,
        ),
        fetchedAtMs: rows.first['fetched_at'] as int,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> saveProfile(String pubkey, NostrProfile profile) async {
    final database = await db;
    await database.insert('profiles', {
      'pubkey': pubkey,
      'json': jsonEncode(profile.toJson()),
      'fetched_at': DateTime.now().millisecondsSinceEpoch,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  /// Local people search over the persistent profile cache — zero network.
  /// Matches name/display_name/nip05/about. Powers the search screen's
  /// local fallback (was a 500-event relay query per query). Returns
  /// (pubkey, profile) pairs — NostrProfile carries no key of its own.
  Future<List<({String pubkey, NostrProfile profile})>> searchProfiles(
    String query, {
    int limit = 20,
  }) async {
    final database = await db;
    final like = '%${query.replaceAll('%', r'\%').replaceAll('_', r'\_')}%';
    final rows = await database.rawQuery(
      '''
      SELECT pubkey, json FROM profiles
      WHERE json LIKE ? ESCAPE '\\'
      ORDER BY fetched_at DESC
      LIMIT ?
      ''',
      [like, limit * 4], // over-fetch; JSON parse + field-match refines below
    );
    final out = <({String pubkey, NostrProfile profile})>[];
    for (final row in rows) {
      try {
        final p = NostrProfile.fromJson(
          jsonDecode(row['json'] as String) as Map<String, dynamic>,
        );
        // Field-level match (LIKE on raw JSON would hit URLs/banner strings).
        final hay = [
          p.name ?? '',
          p.displayName ?? '',
          p.nip05 ?? '',
          p.about ?? '',
        ].join(' ').toLowerCase();
        if (hay.contains(query)) {
          out.add((pubkey: row['pubkey'] as String, profile: p));
        }
        if (out.length >= limit) break;
      } catch (_) {}
    }
    return out;
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
    int sum(Map<String, Object?> r) => (r['b'] as num? ?? 0).toInt();
    final ev = sum(
      (await database.rawQuery(
        "SELECT COALESCE(SUM(LENGTH(content)+LENGTH(tags)+LENGTH(sig)),0) AS b FROM events",
      )).first,
    );
    final prof = sum(
      (await database.rawQuery(
        "SELECT COALESCE(SUM(LENGTH(json)),0) AS b FROM profiles",
      )).first,
    );
    return ev + prof;
  }

  /// Row counts per table (Settings → Storage diagnostics).
  Future<({int events, int refs, int profiles})> counts() async {
    final database = await db;
    Future<int> c(String t) async =>
        Sqflite.firstIntValue(
          await database.rawQuery('SELECT COUNT(*) FROM $t'),
        ) ??
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
