import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/relay/relay_core.dart';
import 'package:nostrfeed_mobile/core/relay/relay_transport.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0007 — the merged local+remote subscribe the EventBus runs on.
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

  late LocalRelay relay;
  late StreamController<NostrEvent> remote;

  setUp(() async {
    await EventStore.instance.debugReset();
    EventStore.debugOpenOverride = null;
    await openStore();
    relay = LocalRelay(store: EventStore.instance);
    remote = StreamController<NostrEvent>.broadcast();
  });

  tearDown(() async {
    await remote.close();
    await relay.dispose();
    EventStore.debugOpenOverride = null;
    await EventStore.instance.debugReset();
  });

  MergedRelayTransport transport({bool enabled = true}) => MergedRelayTransport(
        localRelay: relay,
        remoteSubscribe: (_) => remote.stream,
        enabled: enabled,
      );

  Future<List<NostrEvent>> collect(
    Stream<NostrEvent> stream, {
    Duration for_ = const Duration(milliseconds: 120),
  }) async {
    final out = <NostrEvent>[];
    final sub = stream.listen(out.add);
    await Future<void>.delayed(for_);
    await sub.cancel();
    return out;
  }

  test('remote-only when the flag is off (rollback)', () async {
    final t = transport(enabled: false);
    final events = collect(t.subscribe([NostrFilter(kinds: [1])]));
    relay.onEvent(ev(id: h(1))); // local must be ignored when disabled
    remote.add(ev(id: h(2)));
    final got = await events;
    expect(got.map((e) => e.id), [h(2)]);
  });

  test('merges local live + remote events, deduped by id', () async {
    final t = transport();
    final events = collect(t.subscribe([NostrFilter(kinds: [1])]));

    // Same event on both transports → once.
    final shared = ev(id: h(10));
    relay.onEvent(shared);
    remote.add(shared);
    // One local-only, one remote-only.
    relay.onEvent(ev(id: h(11)));
    remote.add(ev(id: h(12)));

    final got = await events;
    expect(got.map((e) => e.id).toSet(), {h(10), h(11), h(12)});
    // Dedup: h(10) appears exactly once.
    expect(got.where((e) => e.id == h(10)).length, 1);
  });

  test('local live events respect the REQ filters', () async {
    final t = transport();
    final events = collect(t.subscribe([NostrFilter(kinds: [7])]));
    relay.onEvent(ev(id: h(20), kind: 1)); // filtered out
    relay.onEvent(ev(id: h(21), kind: 7)); // matches
    final got = await events;
    expect(got.map((e) => e.id), [h(21)]);
  });

  test('a dead remote never kills the merged stream', () async {
    final t = transport();
    final dead = MergedRelayTransport(
      localRelay: relay,
      remoteSubscribe: (_) =>
          Stream<NostrEvent>.error(StateError('relay down')),
      enabled: true,
    );
    final events = collect(dead.subscribe([NostrFilter(kinds: [1])]));
    relay.onEvent(ev(id: h(30))); // local still flows
    final got = await events;
    expect(got.map((e) => e.id), [h(30)]);
    expect(t.enabled, isTrue);
  });

  test('null local relay falls back to remote-only', () async {
    final t = MergedRelayTransport(
      localRelay: null,
      remoteSubscribe: (_) => remote.stream,
      enabled: true,
    );
    final events = collect(t.subscribe([NostrFilter(kinds: [1])]));
    remote.add(ev(id: h(40)));
    final got = await events;
    expect(got.map((e) => e.id), [h(40)]);
  });
}
