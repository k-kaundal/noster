import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/store_host.dart';
import 'package:nostrfeed_mobile/core/providers/store_invalidation.dart'
    show StoreTable;
import 'package:sqflite/sqflite.dart';

/// ADR-0008 (God-object split) — the notification store (`notifications`
/// table). The bell's projection; the badge COUNT is an instant partial-
/// index query (`WHERE read_at IS NULL`). Zero interaction with ingest.
class NotificationStore {
  NotificationStore(this._host);
  final StoreHost _host;

  /// Record a notification (idempotent — INSERT OR REPLACE on the event id).
  Future<void> upsertNotification(DbNotification n) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.insert('notifications', n.toRow(),
            conflictAlgorithm: ConflictAlgorithm.replace);
      }, touches: {StoreTable.notifications});

  /// Batch-ingest notifications in ONE transaction (historical first paint).
  Future<void> upsertNotificationsBatch(List<DbNotification> list) =>
      _host.enqueueWrite(() async {
        if (list.isEmpty) return;
        final database = await _host.db;
        await database.transaction((txn) async {
          final batch = txn.batch();
          for (final n in list) {
            batch.insert('notifications', n.toRow(),
                conflictAlgorithm: ConflictAlgorithm.replace);
          }
          await batch.commit(noResult: true);
        });
      }, touches: {StoreTable.notifications});

  /// Notifications for [recipient], newest first, keyset-paged with [until].
  Future<List<DbNotification>> notificationsFor(
    String recipient, {
    int limit = 100,
    int? until,
  }) async {
    final database = await _host.db;
    final rows = await database.query(
      'notifications',
      where: until != null
          ? 'recipient = ? AND created_at < ?'
          : 'recipient = ?',
      whereArgs: until != null ? [recipient, until] : [recipient],
      orderBy: 'created_at DESC',
      limit: limit,
    );
    return rows.map(DbNotification.fromRow).toList();
  }

  /// Unread count for [recipient] — instant (partial index on read_at NULL).
  Future<int> unreadNotificationCount(String recipient) async {
    final database = await _host.db;
    return Sqflite.firstIntValue(await database.rawQuery(
          'SELECT COUNT(*) FROM notifications '
          'WHERE recipient = ? AND read_at IS NULL',
          [recipient],
        )) ??
        0;
  }

  /// The unread watermark: newest `created_at` that is still unread, or 0.
  Future<int> notificationWatermark(String recipient) async {
    final database = await _host.db;
    final r = await database.rawQuery(
      'SELECT COALESCE(MAX(created_at),0) AS w FROM notifications '
      'WHERE recipient = ? AND read_at IS NOT NULL',
      [recipient],
    );
    return (r.first['w'] as num).toInt();
  }

  /// Mark ALL of [recipient]'s notifications read (stamp read_at = watermark).
  Future<void> markAllNotificationsRead(String recipient, int watermark) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.rawUpdate(
          'UPDATE notifications SET read_at = ? '
          'WHERE recipient = ? AND read_at IS NULL',
          [watermark, recipient],
        );
      }, touches: {StoreTable.notifications});

  /// Mark ONE notification read (tap-through).
  Future<void> markNotificationRead(String id, int watermark) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.update(
          'notifications',
          {'read_at': watermark},
          where: 'id = ?',
          whereArgs: [id],
        );
      }, touches: {StoreTable.notifications});

  /// Wipe all notifications for [recipient] (logout / account switch).
  Future<void> clearNotifications(String recipient) =>
      _host.enqueueWrite(() async {
        final database = await _host.db;
        await database.delete('notifications',
            where: 'recipient = ?', whereArgs: [recipient]);
      }, touches: {StoreTable.notifications});
}
