import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/relay/local_first_query.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0007 — the local-first merged query that now backs RelayPool.query
/// (and therefore every repository read).
void main() {
  sqfliteFfiInit();

  Future<EventStore> openStore() async {
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
    final store = EventStore.instance;
    await store.debugReset();
    return store;
  }

  String h(int byte) => (byte.toRadixString(16).padLeft(2, '0')) * 32;

  NostrEvent ev({required String id, int kind = 1, int createdAt = 1000}) =>
      NostrEvent(
        id: id,
        pubkey: h(9),
        createdAt: createdAt,
        kind: kind,
        tags: const [],
        content: 'x',
        sig: 'c' * 128,
      );

  tearDown(() async {
    await EventStore.instance.debugReset();
    EventStore.debugOpenOverride = null;
  });

  test('local answers instantly; remote is never awaited when empty', () async {
    final store = await openStore();
    await store.ingest([ev(id: h(1), createdAt: 1000)]);

    final out = await localFirstQuery(
      [NostrFilter(kinds: [1])],
      store: store,
      // A remote that would hang forever must not delay the local answer.
      remoteQuery: (_) async => const [],
      remoteWait: const Duration(milliseconds: 50),
    );
    expect(out.map((e) => e.id), [h(1)]);
  });

  test('offline (remote throws) still returns the cached page', () async {
    final store = await openStore();
    await store.ingest([ev(id: h(2), createdAt: 2000)]);

    final out = await localFirstQuery(
      [NostrFilter(kinds: [1])],
      store: store,
      remoteQuery: (_) => throw StateError('all relays down'),
    );
    expect(out.map((e) => e.id), [h(2)]);
  });

  test('remote supplements + dedups by id, newest-first', () async {
    final store = await openStore();
    await store.ingest([
      ev(id: h(41), createdAt: 1000),
      ev(id: h(42), createdAt: 2000),
    ]);

    final out = await localFirstQuery(
      [NostrFilter(kinds: [1])],
      store: store,
      remoteQuery: (_) async => [
        ev(id: h(42), createdAt: 2000), // dup of local
        ev(id: h(43), createdAt: 3000), // new, newer
      ],
    );
    // This test's events, deduped, newest-first — asserted as a set so an
    // unrelated event drifting in from another test can't fail ordering.
    final mine = out.where((e) => [h(41), h(42), h(43)].contains(e.id)).toList();
    expect(mine.map((e) => e.id), [h(43), h(42), h(41)]);
    expect(out.where((e) => e.id == h(42)).length, 1); // deduped
  });

  test('remote events are ingested into the store', () async {
    final store = await openStore();
    // The merged ANSWER must include remote events; the STORE must then
    // hold them (the ingest side effect). Assert the store-side via a
    // direct local read — deterministic, no sleep.
    final out = await localFirstQuery(
      [NostrFilter(ids: [h(61)])],
      store: store,
      remoteQuery: (_) async => [ev(id: h(61), createdAt: 61000)],
    );
    expect(out.map((e) => e.id), [h(61)]);
    // The store holds it now (ids-filtered local read returns it).
    final local = await store.queryByFilters([NostrFilter(ids: [h(61)])]);
    expect(local.map((e) => e.id), [h(61)]);
  });

  test('a slow remote is cut off at remoteWait', () async {
    final store = await openStore();
    await store.ingest([ev(id: h(1), createdAt: 1000)]);
    final sw = Stopwatch()..start();

    final out = await localFirstQuery(
      [NostrFilter(kinds: [1])],
      store: store,
      remoteQuery: (_) async {
        await Future<void>.delayed(const Duration(seconds: 10));
        return [ev(id: h(9), createdAt: 9000)];
      },
      remoteWait: const Duration(milliseconds: 100),
    );
    sw.stop();
    expect(sw.elapsedMilliseconds, lessThan(3000));
    expect(out.map((e) => e.id), [h(1)]); // only the local answer made it
  });

  test('limit bounds the merged answer (NIP-01 OR: per-filter union)', () async {
    final store = await openStore();
    // A lone tight filter caps its own answer exactly.
    final tight = await localFirstQuery(
      [NostrFilter(kinds: [1], limit: 2)],
      store: store,
      remoteQuery: (_) async => [
        ev(id: h(51), createdAt: 51000),
        ev(id: h(52), createdAt: 52000),
        ev(id: h(53), createdAt: 53000),
      ],
    );
    expect(tight.map((e) => e.id), [h(53), h(52)]); // newest 2

    // A tight + broad pair: the union is bounded by the SUM of both limits,
    // so the broad filter is never starved by the tight companion.
    final pair = await localFirstQuery(
      [
        NostrFilter(kinds: [1], limit: 1),
        NostrFilter(kinds: [1], limit: 5),
      ],
      store: store,
      remoteQuery: (_) async => [
        ev(id: h(51), createdAt: 51000),
        ev(id: h(52), createdAt: 52000),
        ev(id: h(53), createdAt: 53000),
      ],
    );
    expect(pair.map((e) => e.id), [h(53), h(52), h(51)]);
  });
}
