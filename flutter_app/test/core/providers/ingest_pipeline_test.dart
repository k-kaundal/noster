import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/event_bus.dart';
import 'package:nostrfeed_mobile/core/providers/content_providers.dart';
import 'package:nostrfeed_mobile/core/providers/ingest_pipeline_providers.dart';
import 'package:nostrfeed_mobile/core/providers/nostr_service_providers.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

void main() {
  sqfliteFfiInit();

  NostrEvent ev({
    required String id,
    int kind = 7,
    int createdAt = 1000,
    List<List<String>> tags = const [],
  }) =>
      NostrEvent(
        id: id,
        pubkey: 'ab' * 32,
        createdAt: createdAt,
        kind: kind,
        tags: tags,
        content: 'x',
        sig: 'cd' * 64,
      );

  Future<void> openStore() async {
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

  late StreamController<NostrEvent> feed;
  late ProviderContainer container;
  late EventBus bus;

  setUp(() async {
    await EventStore.instance.debugReset();
    await openStore();
    feed = StreamController<NostrEvent>.broadcast();
    container = ProviderContainer(overrides: [
      // A bus fed by the test controller, no real relays.
      eventBusProvider.overrideWith(
        (ref) => EventBus(subscribe: (_) => feed.stream),
      ),
    ]);
    // The bus only ingests from ACQUIRED specs — acquire one so the fake
    // feed is plumbed in (mirrors a real consumer).
    bus = container.read(eventBusProvider);
    bus.acquire([NostrFilter(kinds: [1, 4, 7, 1059, 9735, 30023])]);
  });

  tearDown(() async {
    container.dispose();
    await feed.close();
    EventStore.debugOpenOverride = null;
    await EventStore.instance.debugReset();
  });

  test('pipeline ingests gated bus events into the store', () async {
    container.read(ingestPipelineProvider); // start listening

    final e = ev(id: 'aa' * 32, kind: 1);
    feed.add(e);
    await Future<void>.delayed(const Duration(milliseconds: 50));

    expect((await EventStore.instance.eventById('aa' * 32))?.id, 'aa' * 32);
  });

  test('DM kinds are NOT stored (owned by DmStore)', () async {
    container.read(ingestPipelineProvider);

    feed.add(ev(id: 'bb' * 32, kind: 1059));
    feed.add(ev(id: 'cc' * 32, kind: 4));
    await Future<void>.delayed(const Duration(milliseconds: 50));

    expect(await EventStore.instance.eventById('bb' * 32), isNull);
    expect(await EventStore.instance.eventById('cc' * 32), isNull);
  });

  test('engagement events bump the engagement version (debounced)', () async {
    container.read(ingestPipelineProvider);
    final target = 'dd' * 32;
    final version = () => container.read(engagementVersionProvider);
    final before = version();

    feed.add(ev(id: 'e1', kind: 7, tags: [['e', target]]));
    feed.add(ev(id: 'e2', kind: 7, tags: [['e', target]]));
    feed.add(ev(id: 'e3', kind: 9735, tags: [['e', target]]));
    await Future<void>.delayed(const Duration(milliseconds: 50));
    // Debounced: not yet bumped mid-burst.
    expect(version(), before);

    // 500 ms debounce — poll for the bump with a deadline instead of one
    // fixed sleep: timers are real here (no fakeAsync with stream
    // listeners), and a loaded CI machine can fire the timer late.
    final deadline = DateTime.now().add(const Duration(seconds: 3));
    while (version() != before + 1 && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 25));
    }
    expect(version(), before + 1); // ONE bump for the whole burst

    // Ingest is fire-and-forget in the pipeline; give the writes a beat to
    // commit before reading the index.
    await Future<void>.delayed(const Duration(milliseconds: 100));
    final counts = await EventStore.instance.engagementFor([target]);
    expect(counts[target]?.reactions, 2);
    expect(counts[target]?.zaps, 1);
  });

  test('non-engagement events do not bump the version', () async {
    container.read(ingestPipelineProvider);
    final before = container.read(engagementVersionProvider);

    feed.add(ev(id: 'ff' * 32, kind: 30023)); // article, no e-tags
    await Future<void>.delayed(const Duration(milliseconds: 600));

    expect(container.read(engagementVersionProvider), before);
  });
}
