import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/store_host.dart';
import 'package:sqflite/sqflite.dart';

/// ADR-0008 (God-object split) — the durable publish outbox
/// (`publish_outbox` table): a failed publish (offline, dead socket) is
/// retried by background sync for ALL event kinds, never silently lost.
/// Zero interaction with ingest.
class PublishOutboxStore {
  PublishOutboxStore(this._host);
  final StoreHost _host;

  /// Queue a signed event for durable delivery (pending).
  Future<void> enqueuePublishJob(DbPublishJob job) => _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.insert('publish_outbox', job.toRow(),
            conflictAlgorithm: ConflictAlgorithm.replace);
      });

  /// All pending/failed publish jobs, oldest first (retry order).
  Future<List<DbPublishJob>> publishJobsPending() async {
    final database = await _host.db;
    final rows = await database.query(
      'publish_outbox',
      where: 'state != ?',
      whereArgs: [DbPublishState.sent.v],
      orderBy: 'created_at ASC',
    );
    return rows.map(DbPublishJob.fromRow).toList();
  }

  /// Update a publish job's state (+ bump attempts on retry).
  Future<void> updatePublishJobState(
    String id,
    DbPublishState state, {
    bool bumpAttempts = false,
    String? lastError,
  }) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.rawUpdate(
          'UPDATE publish_outbox SET state = ?'
          '${lastError != null ? ', last_error = ?' : ''}'
          '${bumpAttempts ? ', attempts = attempts + 1' : ''} '
          'WHERE id = ?',
          lastError != null ? [state.v, lastError, id] : [state.v, id],
        );
      });

  /// Drop a publish job (acked, or permanently failed past the retry cap).
  Future<void> removePublishJob(String id) => _host.enqueueWrite(() async {
        final database = await _host.db;
        await database
            .delete('publish_outbox', where: 'id = ?', whereArgs: [id]);
      });
}
