import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0005 P4: feed/trending are SQL projections over the store.
void main() {
  sqfliteFfiInit();

  Future<void> openStore() async {
    // inMemoryDatabasePath = a true :memory: database. NEVER a named path —
    // the ffi factory writes named paths as REAL FILES that persist across
    // test runs, so time-windowed tests accumulated stale events and failed
    // on the second run (the "passes alone, fails in suite" trap).
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

  NostrEvent post({
    required String id,
    int kind = 1,
    int createdAt = 1000,
    String pubkey = 'aa',
    List<List<String>> tags = const [],
  }) =>
      NostrEvent(
        id: id,
        pubkey: pubkey * 32,
        createdAt: createdAt,
        kind: kind,
        tags: tags,
        content: 'post $id',
        sig: 'cd' * 64,
      );

  NostrEvent reply({required String id, required String rootId, int createdAt = 1000}) =>
      post(id: id, createdAt: createdAt, tags: [
        ['e', rootId, '', 'root'],
      ]);

  setUp(() async {
    await EventStore.instance.debugReset();
    await openStore();
  });

  tearDown(() async {
    EventStore.debugOpenOverride = null;
    await EventStore.instance.debugReset();
  });

  group('feedPage', () {
    test('excludes replies in SQL (thread_edges), keeps posts + reposts', () async {
      final store = EventStore.instance;
      final root = 'ff' * 32;
      await store.ingest([
        post(id: 'p1', createdAt: 100),
        post(id: 'p2', kind: 6, createdAt: 200), // repost stays
        reply(id: 'r1', rootId: root, createdAt: 300), // reply excluded
        post(id: 'p3', createdAt: 400),
      ]);

      final page = await store.feedPage(kinds: [1, 6, 16, 20, 30023], limit: 50);
      final ids = page.map((e) => e.id).toList();
      expect(ids, containsAll(['p1', 'p2', 'p3']));
      expect(ids, isNot(contains('r1')));
    });

    test('keyset paging: until-cursor pages never overlap', () async {
      final store = EventStore.instance;
      // 5 posts, newest-first: p5(500) p4(400) p3(300) p2(200) p1(100)
      for (var i = 1; i <= 5; i++) {
        await store.ingest([post(id: 'p$i', createdAt: i * 100)]);
      }

      final page1 = await store.feedPage(kinds: [1], limit: 2);
      expect(page1.map((e) => e.id).toList(), ['p5', 'p4']);

      final page2 = await store.feedPage(
        kinds: [1],
        limit: 2,
        until: page1.last.createdAt,
      );
      expect(page2.map((e) => e.id).toList(), ['p3', 'p2']);

      final page3 = await store.feedPage(
        kinds: [1],
        limit: 2,
        until: page2.last.createdAt,
      );
      expect(page3.map((e) => e.id).toList(), ['p1']);
    });

    test('authors filter restricts to followed pubkeys', () async {
      final store = EventStore.instance;
      await store.ingest([
        post(id: 'a1', pubkey: 'aa'),
        post(id: 'b1', pubkey: 'bb'),
      ]);
      final page = await store.feedPage(
        kinds: [1],
        authors: ['aa' * 32],
      );
      expect(page.map((e) => e.id).toList(), ['a1']);
    });
  });

  group('trendingCandidates', () {
    test('aggregates deduped engagement over the window', () async {
      final store = EventStore.instance;
      final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      final target = 'ee' * 32;
      await store.ingest([
        post(id: target, createdAt: now - 60),
        // 2 reactions (different engagers), 1 reply, 1 zap.
        post(id: 'l1', kind: 7, createdAt: now - 30, pubkey: 'u1', tags: [['e', target]]),
        post(id: 'l2', kind: 7, createdAt: now - 30, pubkey: 'u2', tags: [['e', target]]),
        reply(id: 're1', rootId: target, createdAt: now - 30),
        post(id: 'z1', kind: 9735, createdAt: now - 30, pubkey: 'u3', tags: [['e', target]]),
        // An OLD reaction outside the window — must not count.
        post(id: 'old', kind: 7, createdAt: now - 90000, pubkey: 'u9', tags: [['e', target]]),
      ]);

      final candidates = await store.trendingCandidates(
        sinceSeconds: now - 3600, // last hour
      );
      expect(candidates.length, 1);
      final c = candidates.single;
      expect(c.eventId, target);
      expect(c.reactions, 2);
      expect(c.replies, 1);
      expect(c.zaps, 1);
      expect(c.uniqueEngagers, 4); // u1,u2,reply author,u3 — deduped
    });

    test('the 1h window is a strict subset of 24h (the vice-versa proof)', () async {
      final store = EventStore.instance;
      final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      final hot = 'ab' * 32;
      final older = 'cd' * 32;
      await store.ingest([
        post(id: hot, createdAt: now - 100),
        post(id: older, createdAt: now - 80000), // ~22h old
        post(id: 'x1', kind: 7, createdAt: now - 90, pubkey: 'u1', tags: [['e', hot]]),
        post(id: 'x2', kind: 7, createdAt: now - 70000, pubkey: 'u2', tags: [['e', older]]),
      ]);

      final last1h = await store.trendingCandidates(sinceSeconds: now - 3600);
      final last24h = await store.trendingCandidates(sinceSeconds: now - 86400);

      expect(last1h.map((c) => c.eventId), [hot]);
      expect(
        last24h.map((c) => c.eventId).toSet(),
        containsAll([hot, older]),
      );
    });
  });
}
