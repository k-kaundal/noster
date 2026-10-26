import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/store_invalidation.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0008 P5: per-table invalidation — a write bumps ONLY its table's
/// counter, so features listening to OTHER tables don't rebuild.
void main() {
  sqfliteFfiInit();

  Future<void> openStore() async {
    EventStore.debugOpenOverride = () => databaseFactoryFfi.openDatabase(
          inMemoryDatabasePath,
          options: OpenDatabaseOptions(
            version: 8,
            onCreate: (db, v) async {
              await EventStore.debugCreateV1(db);
              await EventStore.debugOnUpgrade(db, 1, 8);
            },
          ),
        );
  }

  late ProviderContainer container;

  int v(StoreTable t) =>
      container.read(storeInvalidationProvider)[t];

  setUp(() async {
    await EventStore.instance.debugReset();
    await openStore();
    container = ProviderContainer();
    // Wire the bus → the store's writer-lane hook (the app does this at root).
    container.read(storeInvalidationWiringProvider);
  });

  tearDown(() async {
    container.dispose();
    EventStore.debugOpenOverride = null;
    await EventStore.instance.debugReset();
  });

  /// Wait past the bus debounce (300ms) for a table's counter to settle.
  Future<void> settle() =>
      Future<void>.delayed(const Duration(milliseconds: 400));

  test('a DM write bumps dmMessages/dmThreads but NOT engagement/events', () async {
    final ev0 = v(StoreTable.eventRefs);
    final evts0 = v(StoreTable.events);
    final dm0 = v(StoreTable.dmMessages);
    final dt0 = v(StoreTable.dmThreads);

    await EventStore.instance.upsertDmMessage(
      DbMessage(
        id: 'm1',
        peer: 'bb' * 32,
        direction: DbDmDirection.incoming,
        content: 'hi',
        createdAt: 100,
      ),
    );
    await settle();

    expect(v(StoreTable.dmMessages), dm0 + 1); // DM tables bumped
    expect(v(StoreTable.dmThreads), dt0 + 1);
    expect(v(StoreTable.eventRefs), ev0); // engagement NOT bumped
    expect(v(StoreTable.events), evts0); // content NOT bumped
  });

  test('an engagement ingest bumps events+eventRefs but NOT dmMessages', () async {
    final dm0 = v(StoreTable.dmMessages);
    final ev0 = v(StoreTable.events);
    final er0 = v(StoreTable.eventRefs);

    // A kind-7 reaction (engagement kind) — touches events + eventRefs.
    await EventStore.instance.ingest([
      NostrEvent(
        id: 'e1',
        pubkey: 'ab' * 32,
        createdAt: 100,
        kind: 7,
        tags: [
          ['e', 'cc' * 32],
        ],
        content: '+',
        sig: 'cd' * 64,
      ),
    ]);
    await settle();

    expect(v(StoreTable.events), ev0 + 1);
    expect(v(StoreTable.eventRefs), er0 + 1);
    expect(v(StoreTable.dmMessages), dm0); // DM NOT bumped
  });

  test('a notification write bumps notifications only', () async {
    final n0 = v(StoreTable.notifications);
    final ev0 = v(StoreTable.events);

    await EventStore.instance.upsertNotification(
      DbNotification(
        id: 'n1',
        recipient: 'aa' * 32,
        type: DbNotificationType.like,
        actor: 'bb' * 32,
        eventJson: '{}',
        createdAt: 100,
      ),
    );
    await settle();

    expect(v(StoreTable.notifications), n0 + 1);
    expect(v(StoreTable.events), ev0);
  });

  test('a write BURST debounces to ONE bump per table', () async {
    final er0 = v(StoreTable.eventRefs);
    // 5 rapid engagement ingests inside the debounce window.
    for (var i = 0; i < 5; i++) {
      await EventStore.instance.ingest([
        NostrEvent(
          id: 'e$i',
          pubkey: 'ab' * 32,
          createdAt: 100 + i,
          kind: 7,
          tags: [
            ['e', 'cc' * 32],
          ],
          content: '+',
          sig: 'cd' * 64,
        ),
      ]);
    }
    await settle();
    expect(v(StoreTable.eventRefs), er0 + 1); // ONE bump, not 5
  });

  test('bumpNow fires immediately (no debounce) for user-initiated writes', () async {
    final bus = container.read(storeInvalidationProvider.notifier);
    final dm0 = v(StoreTable.dmMessages);
    bus.bumpNow(StoreTable.dmMessages);
    // No settle — the counter is already up (synchronous).
    expect(v(StoreTable.dmMessages), dm0 + 1);
  });
}
