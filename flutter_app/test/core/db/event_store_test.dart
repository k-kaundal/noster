import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// Deterministic EventStore tests over an in-memory SQLite
/// (sqflite_common_ffi — no device paths, no real files).
void main() {
  sqfliteFfiInit();

  /// Open a fresh in-memory DB at v2 (v1 create + v2 upgrade — the same
  /// path a fresh install takes). inMemoryDatabasePath = true :memory: —
  /// a NAMED path is a real file that persists across test runs.
  Future<void> openV2() async {
    EventStore.debugOpenOverride = () => databaseFactoryFfi.openDatabase(
          inMemoryDatabasePath,
          options: OpenDatabaseOptions(
            version: 2,
            onCreate: (db, v) async {
              await EventStore.debugCreateV1(db);
              await EventStore.debugOnUpgrade(db, 1, 2);
            },
          ),
        );
  }

  NostrEvent reply({
    required String id,
    required String rootId,
    int createdAt = 1000,
  }) =>
      NostrEvent(
        id: id,
        pubkey: 'ab' * 32,
        createdAt: createdAt,
        kind: 1,
        tags: [
          ['e', rootId, '', 'root'],
        ],
        content: 'a reply',
        sig: 'cd' * 64,
      );

  setUp(() async {
    // Fresh DB per test: drop the singleton's cached handle first.
    await EventStore.instance.debugReset();
    EventStore.debugOpenOverride = null;
  });

  tearDown(() async {
    EventStore.debugOpenOverride = null;
    await EventStore.instance.debugReset();
  });

  test('thread_edges write at ingest + threadReplies assembles', () async {
    await openV2();
    final store = EventStore.instance;
    final root = 'ff' * 32;
    await store.ingest([reply(id: '11' * 32, rootId: root)]);

    final replies = await store.threadReplies(root);
    expect(replies.length, 1);
    expect(replies.first.id, '11' * 32);
  });

  test('upgrade DDL is idempotent + backfill links existing replies', () async {
    await openV2();
    final store = EventStore.instance;
    final root = 'ee' * 32;
    // Ingest a reply (writes the v2 edge already), then re-run the upgrade —
    // CREATE TABLE IF NOT EXISTS-equivalent safety + backfill must not crash
    // or duplicate edges (PK + INSERT OR IGNORE).
    await store.ingest([reply(id: '22' * 32, rootId: root)]);
    final db = await store.db;
    await EventStore.debugOnUpgrade(db, 1, 2); // re-run migration by hand

    final replies = await store.threadReplies(root);
    expect(replies.length, 1); // not duplicated
  });

  test('seen_on: buffered sightings flush and dedupe', () async {
    await openV2();
    final store = EventStore.instance;
    await store.db;

    store.markSeenOn('aa' * 32, 'wss://relay.one');
    store.markSeenOn('aa' * 32, 'wss://relay.two');
    store.markSeenOn('aa' * 32, 'wss://relay.one'); // dup — IGNOREd
    await store.debugFlushSeenOn();

    final relays = await store.seenOnRelays('aa' * 32);
    expect(relays.toSet(), {'wss://relay.one', 'wss://relay.two'});
  });

  test('repliesFor still works via event_refs (regression)', () async {
    await openV2();
    final store = EventStore.instance;
    final root = 'dd' * 32;
    await store.ingest([reply(id: '33' * 32, rootId: root)]);
    final replies = await store.repliesFor(root);
    expect(replies.single.id, '33' * 32);
  });
}
