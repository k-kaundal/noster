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

  /// Open a fresh in-memory DB at v3 (ADR-0007: full lifecycle).
  Future<void> openV3() async {
    EventStore.debugOpenOverride = () => databaseFactoryFfi.openDatabase(
          inMemoryDatabasePath,
          options: OpenDatabaseOptions(
            version: 3,
            onCreate: (db, v) async {
              await EventStore.debugCreateV1(db);
              await EventStore.debugOnUpgrade(db, 1, 3);
            },
          ),
        );
  }

  NostrEvent ev({
    required String id,
    required String pubkey,
    required int kind,
    int createdAt = 1000,
    List<List<String>> tags = const [],
    String content = 'x',
  }) =>
      NostrEvent(
        id: id,
        pubkey: pubkey,
        createdAt: createdAt,
        kind: kind,
        tags: tags,
        content: content,
        sig: 'cd' * 64,
      );

  String h(int byte) => (byte.toRadixString(16).padLeft(2, '0')) * 32;

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

  // ── ADR-0007 Phase 1: NIP-01 lifecycle ──────────────────────────────

  group('v3 lifecycle — kind classes', () {
    test('ephemeral (20000-29999) is never stored', () async {
      await openV3();
      final store = EventStore.instance;
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 22242), // NIP-42 auth
        ev(id: h(2), pubkey: h(10), kind: 20000),
      ]);
      expect(await store.eventById(h(1)), isNull);
      expect(await store.eventById(h(2)), isNull);
    });

    test('replaceable (kind 0): newest wins, older dropped', () async {
      await openV3();
      final store = EventStore.instance;
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 0, createdAt: 1000, content: 'old'),
      ]);
      await store.ingest([
        ev(id: h(2), pubkey: h(10), kind: 0, createdAt: 2000, content: 'new'),
      ]);
      expect((await store.eventById(h(1))), isNull);
      expect((await store.eventById(h(2)))!.content, 'new');
      // A stale older version arriving late is rejected.
      await store.ingest([
        ev(id: h(3), pubkey: h(10), kind: 0, createdAt: 1500, content: 'stale'),
      ]);
      expect(await store.eventById(h(3)), isNull);
      expect((await store.eventById(h(2)))!.content, 'new');
    });

    test('replaceable tie (same created_at): lowest id wins', () async {
      await openV3();
      final store = EventStore.instance;
      // h(1) < h(2) lexically, so h(1) must be retained.
      await store.ingest([
        ev(id: h(2), pubkey: h(10), kind: 3, createdAt: 1000),
        ev(id: h(1), pubkey: h(10), kind: 3, createdAt: 1000),
      ]);
      expect(await store.eventById(h(1)), isNotNull);
      expect(await store.eventById(h(2)), isNull);
    });

    test('addressable (kind 30023): newest per (pubkey, kind, d)', () async {
      await openV3();
      final store = EventStore.instance;
      List<List<String>> d(String v) => [['d', v]];
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 30023, createdAt: 1000, tags: d('a'), content: 'a-old'),
        ev(id: h(2), pubkey: h(10), kind: 30023, createdAt: 1000, tags: d('b'), content: 'b'),
      ]);
      // Same address 'a', newer → replaces h(1); 'b' untouched.
      await store.ingest([
        ev(id: h(3), pubkey: h(10), kind: 30023, createdAt: 2000, tags: d('a'), content: 'a-new'),
      ]);
      expect(await store.eventById(h(1)), isNull);
      expect((await store.eventById(h(3)))!.content, 'a-new');
      expect((await store.eventById(h(2)))!.content, 'b');
    });

    test('addressable: a STALE older version arriving late never wipes the newer one', () async {
      // Regression: the stale check used `tags = ?` with a LIKE pattern as an
      // equality, which never matched — so a late older version deleted the
      // newer stored one (articles/lists/communities vanished from the UI).
      await openV3();
      final store = EventStore.instance;
      List<List<String>> d(String v) => [['d', v]];
      // New version arrives FIRST (out-of-order delivery, normal on relays).
      await store.ingest([
        ev(id: h(3), pubkey: h(10), kind: 30023, createdAt: 2000, tags: d('a'), content: 'a-new'),
      ]);
      // Then the STALE older version of the same address arrives.
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 30023, createdAt: 1000, tags: d('a'), content: 'a-old'),
      ]);
      // The newer version must survive; the stale one must not be stored.
      expect((await store.eventById(h(3)))!.content, 'a-new');
      expect(await store.eventById(h(1)), isNull);
    });

    test('addressable tie (same created_at, same d): lowest id wins', () async {
      await openV3();
      final store = EventStore.instance;
      List<List<String>> d(String v) => [['d', v]];
      await store.ingest([
        ev(id: h(5), pubkey: h(10), kind: 30003, createdAt: 1000, tags: d('x')),
        ev(id: h(4), pubkey: h(10), kind: 30003, createdAt: 1000, tags: d('x')),
      ]);
      expect(await store.eventById(h(4)), isNotNull);
      expect(await store.eventById(h(5)), isNull);
    });

    test('regular kinds keep every copy', () async {
      await openV3();
      final store = EventStore.instance;
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 1, createdAt: 1000),
        ev(id: h(2), pubkey: h(10), kind: 1, createdAt: 2000),
      ]);
      expect(await store.eventById(h(1)), isNotNull);
      expect(await store.eventById(h(2)), isNotNull);
    });
  });

  group('v3 lifecycle — NIP-09 deletion', () {
    test('kind-5 e-tag deletes a held same-author event + blocks late copy', () async {
      await openV3();
      final store = EventStore.instance;
      await store.ingest([ev(id: h(1), pubkey: h(10), kind: 1)]);
      // The deletion (same author).
      await store.ingest([
        ev(id: h(9), pubkey: h(10), kind: 5, tags: [['e', h(1)]]),
      ]);
      expect(await store.eventById(h(1)), isNull);
      expect(await store.eventById(h(9)), isNotNull); // kind-5 itself stored
      // A late-arriving copy of the deleted event is rejected.
      await store.ingest([ev(id: h(1), pubkey: h(10), kind: 1)]);
      expect(await store.eventById(h(1)), isNull);
    });

    test('kind-5 from a DIFFERENT author does not delete', () async {
      await openV3();
      final store = EventStore.instance;
      await store.ingest([ev(id: h(1), pubkey: h(10), kind: 1)]);
      await store.ingest([
        ev(id: h(9), pubkey: h(11), kind: 5, tags: [['e', h(1)]]), // other author
      ]);
      expect(await store.eventById(h(1)), isNotNull);
    });

    test('kind-5 a-tag deletes an addressable version by coordinate', () async {
      await openV3();
      final store = EventStore.instance;
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 30023, tags: [['d', 'essay']]),
      ]);
      await store.ingest([
        ev(id: h(9), pubkey: h(10), kind: 5, tags: [['a', '30023:${h(10)}:essay']]),
      ]);
      expect(await store.eventById(h(1)), isNull);
    });
  });

  group('v3 — generalized tag index + queryByFilters', () {
    test('#e / #p / #t queries via the tags table', () async {
      await openV3();
      final store = EventStore.instance;
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 1, createdAt: 1000, tags: [
          ['e', h(50), '', 'root'],
          ['p', h(60)],
          ['t', 'nostr'],
        ]),
        ev(id: h(2), pubkey: h(11), kind: 1, createdAt: 2000, tags: [
          ['t', 'bitcoin'],
        ]),
      ]);
      final byE = await store.queryByFilters([
        NostrFilter(tagFilters: {'e': [h(50)]}),
      ]);
      expect(byE.map((e) => e.id), [h(1)]);
      final byP = await store.queryByFilters([
        NostrFilter(tagFilters: {'p': [h(60)]}),
      ]);
      expect(byP.map((e) => e.id), [h(1)]);
      final byT = await store.queryByFilters([
        NostrFilter(tagFilters: {'t': ['bitcoin']}),
      ]);
      expect(byT.map((e) => e.id), [h(2)]);
    });

    test('queryByFilters merges filters with OR + honors limit', () async {
      await openV3();
      final store = EventStore.instance;
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 1, createdAt: 1000),
        ev(id: h(2), pubkey: h(11), kind: 7, createdAt: 2000),
        ev(id: h(3), pubkey: h(12), kind: 1, createdAt: 3000),
      ]);
      final out = await store.queryByFilters([
        NostrFilter(kinds: [1]),
        NostrFilter(kinds: [7]),
      ]);
      expect(out.map((e) => e.id).toSet(), {h(1), h(2), h(3)});
      expect(out.first.id, h(3)); // newest first

      final limited = await store.queryByFilters([
        NostrFilter(kinds: [1], limit: 1),
      ]);
      expect(limited.length, 1);
      expect(limited.first.id, h(3));
    });

    test('queryByFilters: authors + since/until window', () async {
      await openV3();
      final store = EventStore.instance;
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 1, createdAt: 1000),
        ev(id: h(2), pubkey: h(10), kind: 1, createdAt: 5000),
        ev(id: h(3), pubkey: h(11), kind: 1, createdAt: 3000),
      ]);
      final out = await store.queryByFilters([
        NostrFilter(authors: [h(10)], since: 2000, until: 6000),
      ]);
      expect(out.map((e) => e.id), [h(2)]);
    });

    test('v2→v3 upgrade backfills the tags index', () async {
      // Open at v2, ingest, then upgrade to v3 and confirm #tag works.
      await openV2();
      final store = EventStore.instance;
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 1, tags: [['t', 'legacy']]),
      ]);
      final db = await store.db;
      await EventStore.debugOnUpgrade(db, 2, 3);
      final out = await store.queryByFilters([
        NostrFilter(tagFilters: {'t': ['legacy']}),
      ]);
      expect(out.map((e) => e.id), [h(1)]);
    });
  });

  group('v3 — NIP-40 expiration', () {
    test('expired events are excluded from queryByFilters', () async {
      await openV3();
      final store = EventStore.instance;
      final past = (DateTime.now().millisecondsSinceEpoch ~/ 1000) - 3600;
      await store.ingest([
        ev(id: h(1), pubkey: h(10), kind: 1, createdAt: 1000, tags: [
          ['expiration', '$past'],
        ]),
        ev(id: h(2), pubkey: h(10), kind: 1, createdAt: 1000),
      ]);
      final out = await store.queryByFilters([NostrFilter(kinds: [1])]);
      expect(out.map((e) => e.id), [h(2)]);
    });
  });
}
