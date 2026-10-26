import 'package:nostrfeed_mobile/core/db/store_host.dart';
import 'package:sqflite/sqflite.dart';

/// ADR-0008 (God-object split) — the maintenance store: bounded storage
/// (prune), storage diagnostics (`storeBytes`/`counts`), and full wipe
/// (`clear`). Owns the per-table budget enforcement for EVERY table (feed
/// tables + the new feature tables — which were outside the budget until
/// the per-table caps landed here).
class MaintenanceStore {
  MaintenanceStore(this._host);
  final StoreHost _host;

  /// Storage budget. X/FB/Instagram all bound their on-device cache and evict
  /// least-recently-used content — the app must never grow until it fills the
  /// user's storage.
  static const int maxEventRows = 3000; // hard row cap
  static const int maxStoreBytes = 24 * 1024 * 1024; // ~24 MB of content
  static const int maxProfiles = 1500;
  // Per-table budgets for the feature tables (bounded like the feed).
  static const int maxDmMessages = 10000; // people keep chats — generous
  static const int maxNotifications = 500;
  static const int maxMediaRows = 2000;

  /// Current store size in bytes (events + refs + profiles), for Settings
  /// and for budget-driven pruning.
  Future<int> storeBytes() async {
    final database = await _host.db;
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
    final database = await _host.db;
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

  /// Prune to the storage budget. Called fire-and-forget after ingests
  /// (never on the render path). Runs on the writer lane.
  Future<void> prune() => _host.enqueueWrite(_pruneImpl);

  Future<void> _pruneImpl() async {
    final database = await _host.db;
    await database.transaction((txn) async {
      // 0. NIP-40: delete expired rows FIRST (cheap index probe).
      await _deleteExpired(txn);
      // 1. Row cap.
      await _dropOldestBeyond(txn, maxEventRows);

      // 3. Profiles LRU cap.
      await txn.rawDelete(
        'DELETE FROM profiles WHERE pubkey NOT IN '
        '(SELECT pubkey FROM profiles ORDER BY fetched_at DESC LIMIT ?)',
        [maxProfiles],
      );

      // 4. Per-table budgets (the feature tables were OUTSIDE the budget).
      await _capTable(txn, 'notifications', maxNotifications, 'created_at');
      await _capTable(txn, 'dm_messages', maxDmMessages, 'created_at');
      // media has no created_at column — cap by rowid (monotonic insertion).
      await _capTable(txn, 'media', maxMediaRows, 'rowid');
      // author_relays: keep only each author's top relays. INLINED (calling
      // the RelayStore's enqueueWrite from inside this txn would deadlock).
      await txn.rawDelete(
        '''
        DELETE FROM author_relays WHERE (pubkey, relay_url) NOT IN (
          SELECT pubkey, relay_url FROM author_relays a
          WHERE (
            SELECT COUNT(*) FROM author_relays b
            WHERE b.pubkey = a.pubkey AND b.event_count >= a.event_count
          ) <= 5
        )
        ''',
      );
      // publish_outbox: tombstone acked/expired jobs older than 7 days.
      await txn.rawDelete(
        'DELETE FROM publish_outbox WHERE created_at < ?',
        [DateTime.now().millisecondsSinceEpoch ~/ 1000 - 7 * 24 * 3600],
      );
    });

    // 2. Byte budget (outside the txn — re-measures between passes).
    for (var pass = 0; pass < 5; pass++) {
      if (await storeBytes() <= maxStoreBytes) break;
      final current = await counts();
      final dropTo = (current.events * 0.8).floor();
      await database.transaction(
        (txn) => _dropOldestBeyond(txn, dropTo < 100 ? 100 : dropTo),
      );
    }

    // PASSIVE WAL checkpoint off the hot path (keeps the WAL small so read
    // perf never degrades; non-blocking, best-effort).
    try {
      await database.execute('PRAGMA wal_checkpoint(PASSIVE)');
    } catch (_) {}
  }

  /// Delete rows whose NIP-40 `expires_at` is in the past, with tag/ref edges.
  Future<void> _deleteExpired(Transaction txn) async {
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final rows = await txn.query(
      'events',
      columns: ['id'],
      where: 'expires_at IS NOT NULL AND expires_at < ?',
      whereArgs: [now],
    );
    if (rows.isEmpty) return;
    final ids = rows.map((r) => r['id'] as String).toList();
    final placeholders = List.filled(ids.length, '?').join(',');
    await txn.delete('events', where: 'id IN ($placeholders)', whereArgs: ids);
    await txn.delete('tags', where: 'event_id IN ($placeholders)', whereArgs: ids);
    await txn.delete('event_refs', where: 'event_id IN ($placeholders)', whereArgs: ids);
  }

  /// Delete the oldest events beyond [keep] (LRU by created_at) + edges.
  Future<void> _dropOldestBeyond(Transaction txn, int keep) async {
    final cutoff = await txn.rawQuery(
      'SELECT id FROM events ORDER BY created_at DESC LIMIT -1 OFFSET ?',
      [keep],
    );
    if (cutoff.isEmpty) return;
    final ids = cutoff.map((r) => r['id'] as String).toList();
    final placeholders = List.filled(ids.length, '?').join(',');
    await txn.delete('events', where: 'id IN ($placeholders)', whereArgs: ids);
    // ADR-0008 P0 fix — the tags ORPHAN LEAK: pruned events used to leave
    // their `tags` rows behind forever (unbounded growth of the index table).
    await txn.delete(
      'tags',
      where: 'event_id IN ($placeholders)',
      whereArgs: ids,
    );
    // Refs POINTING from dropped events; refs TO dropped events stay.
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

  /// Cap an ordered table at [keep] rows (drop oldest by [orderCol]).
  Future<void> _capTable(
    Transaction txn,
    String table,
    int keep,
    String orderCol,
  ) async {
    await txn.rawDelete(
      'DELETE FROM $table WHERE $orderCol < '
      '(SELECT COALESCE((SELECT $orderCol FROM $table '
      ' ORDER BY $orderCol DESC LIMIT 1 OFFSET ?), 0))',
      [keep],
    );
  }

  /// Wipe the store (logout / account switch). Clears ALL tables — including
  /// `tags`, `thread_edges`, `seen_on`, `deletions`, which the old version
  /// left behind (stale provenance/deletion data leaking into a fresh
  /// account). Runs on the writer lane.
  Future<void> clear() => _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.delete('event_refs');
        await database.delete('tags');
        await database.delete('thread_edges');
        await database.delete('seen_on');
        await database.delete('deletions');
        await database.delete('events');
        await database.delete('profiles');
      });
}
