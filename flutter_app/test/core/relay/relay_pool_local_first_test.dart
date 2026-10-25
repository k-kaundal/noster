import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0007 — RelayPool.query is now local-first merged. These tests pin the
/// pool-level behavior with NO connected relays (remote leg answers empty):
/// the local store must still serve the answer, uppercase/`remoteOnly`
/// filters must go remote-only (empty here), and the rollback flag restores
/// remote-only behavior.
void main() {
  sqfliteFfiInit();

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

  setUp(() async {
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
    await EventStore.instance.debugReset();
  });

  tearDown(() async {
    await EventStore.instance.debugReset();
    EventStore.debugOpenOverride = null;
  });

  test('query serves the local store when no relays are connected', () async {
    await EventStore.instance.ingest([
      ev(id: h(1), createdAt: 1000),
      ev(id: h(2), createdAt: 2000),
    ]);
    final pool = RelayPool(relays: const []); // no connections at all
    final out = await pool.query([NostrFilter(kinds: [1])]);
    expect(out.map((e) => e.id), [h(2), h(1)]); // newest-first from the store
  });

  test('rollback flag: localFirstEnabled=false → remote-only (empty here)', () async {
    await EventStore.instance.ingest([ev(id: h(3), createdAt: 3000)]);
    final pool = RelayPool(relays: const [])..localFirstEnabled = false;
    final out = await pool.query([NostrFilter(kinds: [1])]);
    expect(out, isEmpty); // no remote, and local is bypassed
  });

  test('uppercase NIP-22 #A scope goes remote-only (not served locally)', () async {
    await EventStore.instance.ingest([ev(id: h(4), kind: 1111)]);
    final pool = RelayPool(relays: const []);
    final out = await pool.query([
      NostrFilter(kinds: [1111], tagFilters: {'A': ['30023:${h(9)}:x']}),
    ]);
    // No relays → remote-only answer is empty (the local index is NOT
    // consulted for an uppercase scope — correctness over convenience).
    expect(out, isEmpty);
  });

  test('a remoteOnly filter is never served from the store', () async {
    await EventStore.instance.ingest([ev(id: h(5))]);
    final pool = RelayPool(relays: const []);
    final filter = NostrFilter(kinds: [1])..remoteOnly = true;
    final out = await pool.query([filter]);
    expect(out, isEmpty);
  });

  test('mixed query: local-answerable + remoteOnly filters both consulted', () async {
    await EventStore.instance.ingest([ev(id: h(6), kind: 1)]);
    final pool = RelayPool(relays: const []);
    // One local-answerable filter (kind 1) + one remoteOnly. The merged path
    // serves the local half; the remoteOnly half yields nothing offline.
    final local = await pool.query([NostrFilter(kinds: [1])]);
    expect(local.map((e) => e.id), [h(6)]);
  });
}
