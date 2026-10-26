import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/store_host.dart';
import 'package:nostrfeed_mobile/core/providers/store_invalidation.dart'
    show StoreTable;
import 'package:sqflite/sqflite.dart';

/// ADR-0008 (God-object split) — the relay fleet store (`relay_health` +
/// `author_relays`). Tier routing + top-K query fan-out scoring, and the
/// author→relay affinity for outbox routing. Zero interaction with ingest.
class RelayStore {
  RelayStore(this._host);
  final StoreHost _host;

  /// Persist one relay's health record (score/tier/samples). Idempotent.
  Future<void> upsertRelayHealth(DbRelayHealth h) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.insert('relay_health', h.toRow(),
            conflictAlgorithm: ConflictAlgorithm.replace);
      }, touches: {StoreTable.relayHealth});

  /// One relay's health record (null = never seen).
  Future<DbRelayHealth?> relayHealthFor(String url) async {
    final database = await _host.db;
    final rows = await database.query('relay_health',
        where: 'url = ?', whereArgs: [url], limit: 1);
    return rows.isEmpty ? null : DbRelayHealth.fromRow(rows.first);
  }

  /// Every relay's health record (the pool loads this once at init).
  Future<List<DbRelayHealth>> allRelayHealth() async {
    final database = await _host.db;
    final rows = await database.query('relay_health');
    return rows.map(DbRelayHealth.fromRow).toList();
  }

  /// Increment an author's relay affinity (a relay delivered their event).
  Future<void> recordAuthorRelay(String pubkey, String relayUrl) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.rawInsert(
          '''
          INSERT INTO author_relays (pubkey, relay_url, event_count)
          VALUES (?, ?, 1)
          ON CONFLICT(pubkey, relay_url) DO UPDATE SET
            event_count = event_count + 1
          ''',
          [pubkey, relayUrl],
        );
      });

  /// The relays that delivered [pubkey]'s events, most-active first.
  Future<List<String>> authorRelaysFor(String pubkey, {int limit = 5}) async {
    final database = await _host.db;
    final rows = await database.query(
      'author_relays',
      columns: ['relay_url'],
      where: 'pubkey = ?',
      whereArgs: [pubkey],
      orderBy: 'event_count DESC',
      limit: limit,
    );
    return rows.map((r) => r['relay_url'] as String).toList();
  }

  /// Bound affinity growth (prune hook): keep only each author's top-N.
  Future<void> pruneAuthorRelays({int keepPerAuthor = 5}) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.rawDelete(
          '''
          DELETE FROM author_relays WHERE (pubkey, relay_url) NOT IN (
            SELECT pubkey, relay_url FROM author_relays a
            WHERE (
              SELECT COUNT(*) FROM author_relays b
              WHERE b.pubkey = a.pubkey AND b.event_count >= a.event_count
            ) <= ?
          )
          ''',
          [keepPerAuthor],
        );
      });
}
