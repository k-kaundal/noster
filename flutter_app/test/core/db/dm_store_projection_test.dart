import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0008 P1: messaging is a store projection (dm_messages/dm_threads/
/// dm_outbox), not a memory-only cache.
void main() {
  sqfliteFfiInit();

  Future<void> openCurrent() async {
    EventStore.debugOpenOverride = () => databaseFactoryFfi.openDatabase(
          inMemoryDatabasePath,
          options: OpenDatabaseOptions(
            version: 5,
            onCreate: (db, v) async {
              await EventStore.debugCreateV1(db);
              await EventStore.debugOnUpgrade(db, 1, 5);
            },
          ),
        );
  }

  final peer = 'bb' * 32;

  DbMessage msg(
    String id,
    DbDmDirection dir,
    int ts, {
    String content = 'hi',
    DbMessageStatus status = DbMessageStatus.sent,
  }) =>
      DbMessage(
        id: id,
        peer: peer,
        direction: dir,
        content: content,
        createdAt: ts,
        status: status,
      );

  setUp(() async {
    await EventStore.instance.debugReset();
    await openCurrent();
  });

  tearDown(() async {
    EventStore.debugOpenOverride = null;
    await EventStore.instance.debugReset();
  });

  test('upsertDmMessage stores a message + maintains the thread row', () async {
    final store = EventStore.instance;
    await store.upsertDmMessage(msg('m1', DbDmDirection.incoming, 100));
    final msgs = await store.dmMessagesFor(peer);
    expect(msgs.single.id, 'm1');
    expect(msgs.single.content, 'hi');

    final threads = await store.dmThreads();
    expect(threads.single.peer, peer);
    expect(threads.single.lastMsgAt, 100);
    expect(threads.single.unreadCount, 1); // incoming → unread++
  });

  test('incoming bumps unread; outgoing does NOT (badge counts peer msgs)', () async {
    final store = EventStore.instance;
    await store.upsertDmMessage(msg('i1', DbDmDirection.incoming, 100));
    await store.upsertDmMessage(msg('i2', DbDmDirection.incoming, 200));
    await store.upsertDmMessage(msg('o1', DbDmDirection.outgoing, 300));
    expect(await store.dmTotalUnread(), 2); // only the 2 incoming
  });

  test('thread rows merge across peers; newest activity sorts first', () async {
    final store = EventStore.instance;
    final peer2 = 'cc' * 32;
    await store.upsertDmMessage(msg('a', DbDmDirection.incoming, 100));
    await store.upsertDmMessage(
      DbMessage(
        id: 'b',
        peer: peer2,
        direction: DbDmDirection.incoming,
        content: 'x',
        createdAt: 500,
      ),
    );
    final threads = await store.dmThreads();
    expect(threads.map((t) => t.peer).toList(), [peer2, peer]); // newest first
  });

  test('markDmThreadRead resets unread + advances the watermark', () async {
    final store = EventStore.instance;
    await store.upsertDmMessage(msg('i1', DbDmDirection.incoming, 100));
    await store.upsertDmMessage(msg('i2', DbDmDirection.incoming, 200));
    expect(await store.dmTotalUnread(), 2);

    await store.markDmThreadRead(peer, 200);
    expect(await store.dmTotalUnread(), 0);
    expect(await store.dmThreadLastRead(peer), 200);

    // A NEW incoming message after the read is unread again.
    await store.upsertDmMessage(msg('i3', DbDmDirection.incoming, 300));
    expect(await store.dmTotalUnread(), 1);
  });

  test('markDmThreadRead never moves the watermark BACKWARD', () async {
    final store = EventStore.instance;
    await store.markDmThreadRead(peer, 500);
    await store.markDmThreadRead(peer, 300); // stale — must not regress
    expect(await store.dmThreadLastRead(peer), 500);
  });

  test('recomputeDmUnread recounts incoming-after-watermark from messages', () async {
    final store = EventStore.instance;
    await store.upsertDmMessage(msg('i1', DbDmDirection.incoming, 100));
    await store.upsertDmMessage(msg('i2', DbDmDirection.incoming, 200));
    await store.markDmThreadRead(peer, 150);
    // Force a drift (unread was 1 from i2), then recompute from source rows.
    await store.recomputeDmUnread(peer);
    // Only i2 (created 200 > watermark 150) is unread.
    expect(await store.dmTotalUnread(), 1);
  });

  test('dmMessagesFor pages with until (keyset, no overlap)', () async {
    final store = EventStore.instance;
    for (var i = 1; i <= 5; i++) {
      await store.upsertDmMessage(msg('m$i', DbDmDirection.incoming, i * 100));
    }
    final page1 = await store.dmMessagesFor(peer, limit: 2);
    expect(page1.map((m) => m.id).toList(), ['m5', 'm4']); // newest first
    final page2 = await store.dmMessagesFor(peer, limit: 2, until: 400);
    expect(page2.map((m) => m.id).toList(), ['m3', 'm2']);
  });

  test('updateDmMessageStatus flips pending → sent / failed', () async {
    final store = EventStore.instance;
    await store.upsertDmMessage(
      msg('o1', DbDmDirection.outgoing, 100, status: DbMessageStatus.pending),
    );
    expect((await store.dmMessageById('o1'))!.status, DbMessageStatus.pending);
    await store.updateDmMessageStatus('o1', DbMessageStatus.sent);
    expect((await store.dmMessageById('o1'))!.status, DbMessageStatus.sent);
  });

  group('dm_outbox (durable retry)', () {
    DbOutboxMessage entry(String id, int ts) => DbOutboxMessage(
          id: id,
          peer: peer,
          payloadJson: '[{"wrap":"json"}]',
          createdAt: ts,
        );

    test('enqueue + pending + state transitions', () async {
      final store = EventStore.instance;
      await store.enqueueDmOutbox(entry('w1', 100));
      await store.enqueueDmOutbox(entry('w2', 200));
      var pending = await store.dmOutboxPending();
      expect(pending.map((e) => e.id).toList(), ['w1', 'w2']); // oldest first

      await store.updateDmOutboxState('w1', DbMessageStatus.sent);
      pending = await store.dmOutboxPending();
      expect(pending.map((e) => e.id).toList(), ['w2']); // w1 acked

      await store.removeDmOutbox('w2');
      expect(await store.dmOutboxPending(), isEmpty);
    });

    test('retry bumps attempts', () async {
      final store = EventStore.instance;
      await store.enqueueDmOutbox(entry('w1', 100));
      await store.updateDmOutboxState('w1', DbMessageStatus.failed, bumpAttempts: true);
      final p = await store.dmOutboxPending();
      expect(p.single.attempts, 1);
      expect(p.single.state, DbMessageStatus.failed);
    });
  });

  test('clearDmData wipes all messaging tables (logout)', () async {
    final store = EventStore.instance;
    await store.upsertDmMessage(msg('m1', DbDmDirection.incoming, 100));
    await store.enqueueDmOutbox(DbOutboxMessage(
      id: 'w1',
      peer: peer,
      payloadJson: '[]',
      createdAt: 100,
    ));
    await store.clearDmData();
    expect(await store.dmMessagesFor(peer), isEmpty);
    expect(await store.dmThreads(), isEmpty);
    expect(await store.dmOutboxPending(), isEmpty);
  });
}
