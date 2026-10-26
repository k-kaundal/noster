import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0008 P2: notifications are a store projection (the bell badge count is
/// an instant partial-index COUNT, history survives cold start).
void main() {
  sqfliteFfiInit();

  Future<void> openCurrent() async {
    EventStore.debugOpenOverride = () => databaseFactoryFfi.openDatabase(
          inMemoryDatabasePath,
          options: OpenDatabaseOptions(
            version: 6,
            onCreate: (db, v) async {
              await EventStore.debugCreateV1(db);
              await EventStore.debugOnUpgrade(db, 1, 6);
            },
          ),
        );
  }

  final me = 'aa' * 32;
  final actor = 'bb' * 32;

  DbNotification n(
    String id,
    int ts, {
    DbNotificationType type = DbNotificationType.like,
    String? recipient,
    int? readAt,
  }) =>
      DbNotification(
        id: id,
        recipient: recipient ?? me,
        type: type,
        actor: actor,
        targetId: 'cc' * 32,
        eventJson: '{"id":"$id"}',
        createdAt: ts,
        readAt: readAt,
      );

  setUp(() async {
    await EventStore.instance.debugReset();
    await openCurrent();
  });

  tearDown(() {
    EventStore.debugOpenOverride = null;
    return EventStore.instance.debugReset();
  });

  test('upsertNotification stores + notificationsFor pages newest-first', () async {
    final store = EventStore.instance;
    for (var i = 1; i <= 5; i++) {
      await store.upsertNotification(n('n$i', i * 100));
    }
    final page1 = await store.notificationsFor(me, limit: 2);
    expect(page1.map((x) => x.id).toList(), ['n5', 'n4']);
    final page2 = await store.notificationsFor(me, limit: 2, until: 400);
    expect(page2.map((x) => x.id).toList(), ['n3', 'n2']);
    expect(page1.first.type, DbNotificationType.like);
    expect(page1.first.isUnread, isTrue);
  });

  test('batch ingest writes N rows in one transaction', () async {
    final store = EventStore.instance;
    await store.upsertNotificationsBatch([
      for (var i = 0; i < 10; i++) n('b$i', i * 100),
    ]);
    expect((await store.notificationsFor(me, limit: 50)).length, 10);
  });

  test('unreadNotificationCount counts only read_at NULL (partial index)', () async {
    final store = EventStore.instance;
    await store.upsertNotificationsBatch([
      n('u1', 100),
      n('u2', 200),
      n('r1', 300, readAt: 400), // already read
    ]);
    expect(await store.unreadNotificationCount(me), 2); // r1 excluded
  });

  test('markAllNotificationsRead stamps read_at → count drops to 0', () async {
    final store = EventStore.instance;
    await store.upsertNotificationsBatch([n('a', 100), n('b', 200)]);
    expect(await store.unreadNotificationCount(me), 2);
    await store.markAllNotificationsRead(me, 250);
    expect(await store.unreadNotificationCount(me), 0);
    // New ones after the read are unread again.
    await store.upsertNotification(n('c', 300));
    expect(await store.unreadNotificationCount(me), 1);
  });

  test('markNotificationRead stamps ONE notification (tap-through)', () async {
    final store = EventStore.instance;
    await store.upsertNotificationsBatch([n('a', 100), n('b', 200)]);
    await store.markNotificationRead('a', 300);
    expect(await store.unreadNotificationCount(me), 1); // only b unread
  });

  test('notificationWatermark = newest READ created_at (the read boundary)', () async {
    final store = EventStore.instance;
    await store.upsertNotificationsBatch([n('a', 100), n('b', 200)]);
    expect(await store.notificationWatermark(me), 0); // nothing read yet
    await store.markAllNotificationsRead(me, 250);
    expect(await store.notificationWatermark(me), 200); // newest read row
  });

  test('per-recipient isolation (multi-account)', () async {
    final store = EventStore.instance;
    final other = 'dd' * 32;
    await store.upsertNotification(n('mine', 100, recipient: me));
    await store.upsertNotification(n('theirs', 200, recipient: other));
    expect((await store.notificationsFor(me)).map((x) => x.id), ['mine']);
    expect((await store.notificationsFor(other)).map((x) => x.id), ['theirs']);
    expect(await store.unreadNotificationCount(me), 1);
    expect(await store.unreadNotificationCount(other), 1);
  });

  test('clearNotifications wipes one recipient only (logout)', () async {
    final store = EventStore.instance;
    final other = 'dd' * 32;
    await store.upsertNotification(n('mine', 100, recipient: me));
    await store.upsertNotification(n('theirs', 200, recipient: other));
    await store.clearNotifications(me);
    expect(await store.notificationsFor(me), isEmpty);
    expect((await store.notificationsFor(other)).length, 1);
  });

  test('idempotent upsert (re-ingest same event id is a no-op)', () async {
    final store = EventStore.instance;
    await store.upsertNotification(n('dup', 100));
    await store.upsertNotification(n('dup', 100));
    await store.upsertNotification(n('dup', 100));
    expect((await store.notificationsFor(me)).length, 1);
  });
}
