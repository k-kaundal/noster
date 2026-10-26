import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/store_host.dart';
import 'package:nostrfeed_mobile/core/providers/store_invalidation.dart'
    show StoreTable;
import 'package:sqflite/sqflite.dart';

/// ADR-0008 (God-object split) — the media metadata store (`media` table):
/// dimensions/blurhash/mime per URL for layout-before-download. Zero
/// interaction with ingest.
class MediaStore {
  MediaStore(this._host);
  final StoreHost _host;

  /// Persist one media attachment's metadata — idempotent (INSERT OR REPLACE).
  Future<void> upsertMedia(DbMedia m) => _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.insert('media', m.toRow(),
            conflictAlgorithm: ConflictAlgorithm.replace);
      }, touches: {StoreTable.media});

  /// One URL's media metadata (null = unknown).
  Future<DbMedia?> mediaFor(String url) async {
    final database = await _host.db;
    final rows = await database.query('media',
        where: 'url = ?', whereArgs: [url], limit: 1);
    return rows.isEmpty ? null : DbMedia.fromRow(rows.first);
  }

  /// All media attachments for an event (the gallery's imeta set).
  Future<List<DbMedia>> mediaForEvent(String eventId) async {
    final database = await _host.db;
    final rows = await database
        .query('media', where: 'event_id = ?', whereArgs: [eventId]);
    return rows.map(DbMedia.fromRow).toList();
  }

  /// Batch-upsert media in ONE transaction (a gallery's imeta parse).
  Future<void> upsertMediaBatch(List<DbMedia> list) =>
      _host.enqueueWrite(() async {
        if (list.isEmpty) return;
        final database = await _host.db;
        await database.transaction((txn) async {
          final batch = txn.batch();
          for (final m in list) {
            batch.insert('media', m.toRow(),
                conflictAlgorithm: ConflictAlgorithm.replace);
          }
          await batch.commit(noResult: true);
        });
      }, touches: {StoreTable.media});
}
