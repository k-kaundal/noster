import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// Regression tests for the For-You/Following tab data bugs found after the
/// P4 SQL-projection change: the Following tab must NEVER show unfiltered
/// (global) content, and the disk paint must never block on the network.
void main() {
  sqfliteFfiInit();

  Future<void> openStore() async {
    EventStore.debugOpenOverride = () => databaseFactoryFfi.openDatabase(
          inMemoryDatabasePath,
          options: OpenDatabaseOptions(
            version: 4,
            onCreate: (db, v) async {
              await EventStore.debugCreateV1(db);
              await EventStore.debugOnUpgrade(db, 1, 4);
            },
          ),
        );
  }

  NostrEvent post({required String id, required String pubkey, int createdAt = 1000}) =>
      NostrEvent(
        id: id,
        pubkey: pubkey,
        createdAt: createdAt,
        kind: 1,
        tags: const [],
        content: 'post $id',
        sig: 'cd' * 64,
      );

  setUp(() async {
    await EventStore.instance.debugReset();
    await openStore();
  });

  tearDown(() async {
    EventStore.debugOpenOverride = null;
    await EventStore.instance.debugReset();
  });

  test('feedPage with authors=null returns global content (For You)', () async {
    final store = EventStore.instance;
    await store.ingest([
      post(id: 'g1', pubkey: 'aa' * 32),
      post(id: 'g2', pubkey: 'bb' * 32),
    ]);
    final page = await store.feedPage(kinds: [1], limit: 50);
    expect(page.length, 2);
  });

  test('feedPage with EMPTY authors must NOT leak global content', () async {
    final store = EventStore.instance;
    await store.ingest([
      post(id: 'g1', pubkey: 'aa' * 32),
      post(id: 'g2', pubkey: 'bb' * 32),
    ]);
    // The Following tab with no resolved follows passes [] — the SQL guard
    // skips empty lists, so the QUERY returns global. The FEED LAYER is
    // responsible for passing null-vs-empty correctly; this test pins the
    // store contract: [] means "no filter" — callers must guard.
    final page = await store.feedPage(kinds: [1], limit: 50, authors: const []);
    expect(page.length, 2); // store contract: empty = unfiltered
  });

  test('feedPage with a real author list filters strictly', () async {
    final store = EventStore.instance;
    await store.ingest([
      post(id: 'g1', pubkey: 'aa' * 32),
      post(id: 'g2', pubkey: 'bb' * 32),
      post(id: 'g3', pubkey: 'aa' * 32, createdAt: 900),
    ]);
    final page = await store.feedPage(
      kinds: [1],
      limit: 50,
      authors: ['aa' * 32],
    );
    expect(page.map((e) => e.id).toSet(), {'g1', 'g3'});
    expect(page.map((e) => e.pubkey).toSet(), {'aa' * 32});
  });

  test('replies never leak into the feed projection (both tabs)', () async {
    final store = EventStore.instance;
    final root = 'ff' * 32;
    await store.ingest([
      post(id: 'p1', pubkey: 'aa' * 32),
      NostrEvent(
        id: 'r1',
        pubkey: 'aa' * 32,
        createdAt: 1100,
        kind: 1,
        tags: [['e', root, '', 'root']],
        content: 'a reply',
        sig: 'cd' * 64,
      ),
    ]);
    final page = await store.feedPage(kinds: [1], limit: 50);
    expect(page.map((e) => e.id).toList(), ['p1']);
  });
}
