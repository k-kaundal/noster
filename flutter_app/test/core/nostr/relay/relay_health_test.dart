import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_health.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0008 P3: relay tiers + EWMA health scoring + top-K query fan-out.
void main() {
  sqfliteFfiInit();

  Future<void> openCurrent() async {
    EventStore.debugOpenOverride = () => databaseFactoryFfi.openDatabase(
          inMemoryDatabasePath,
          options: OpenDatabaseOptions(
            version: 7,
            onCreate: (db, v) async {
              await EventStore.debugCreateV1(db);
              await EventStore.debugOnUpgrade(db, 1, 7);
            },
          ),
        );
  }

  setUp(() async {
    await EventStore.instance.debugReset();
    await openCurrent();
  });

  tearDown(() {
    EventStore.debugOpenOverride = null;
    return EventStore.instance.debugReset();
  });

  group('tierOf', () {
    final t = RelayHealthTracker();

    test('platform relays are T0 (our own infra)', () {
      expect(t.tierOf('wss://relay.nostrfeed.com'), DbRelayTier.platform);
      expect(t.tierOf(Env.paidRelay), DbRelayTier.platform);
    });

    test('curated public defaults are T2', () {
      expect(t.tierOf('wss://relay.damus.io'), DbRelayTier.curated);
      expect(t.tierOf('wss://nos.lol'), DbRelayTier.curated);
    });

    test('an unknown outbox relay is T3 ad-hoc', () {
      expect(t.tierOf('wss://some-random-relay.example'), DbRelayTier.adhoc);
    });
  });

  group('EWMA scoring', () {
    test('a connect success raises the score', () {
      final t = RelayHealthTracker();
      const url = 'wss://r1.example';
      t.recordConnectSuccess(url);
      expect(t.scoreOf(url), greaterThan(0));
    });

    test('failures pull the score down (EWMA, not a cliff)', () {
      final t = RelayHealthTracker();
      const url = 'wss://r1.example';
      t.recordConnectSuccess(url);
      t.recordConnectSuccess(url);
      final good = t.scoreOf(url);
      t.recordConnectFailure(url);
      final after = t.scoreOf(url);
      expect(after, lessThan(good));
      expect(after, greaterThan(0)); // one failure doesn't tank a good relay
    });

    test('a fast EOSE scores higher than a slow one', () {
      final t = RelayHealthTracker();
      t.recordEose('wss://fast.example', 200);
      t.recordEose('wss://slow.example', 5000);
      expect(t.scoreOf('wss://fast.example'),
          greaterThan(t.scoreOf('wss://slow.example')));
    });

    test('slow-beyond-window EOSE clamps to 0', () {
      final t = RelayHealthTracker();
      t.recordEose('wss://glacial.example', 99999);
      expect(t.scoreOf('wss://glacial.example'), 0);
    });
  });

  group('ranked + topK', () {
    test('platform relays rank before curated, curated before ad-hoc', () {
      final t = RelayHealthTracker();
      final ranked = t.ranked([
        'wss://adhoc.example',
        'wss://relay.damus.io',
        'wss://relay.nostrfeed.com',
      ]);
      expect(ranked.first, 'wss://relay.nostrfeed.com'); // platform first
      expect(ranked.last, 'wss://adhoc.example'); // ad-hoc last
    });

    test('within a tier, higher score ranks first', () {
      final t = RelayHealthTracker();
      // Two curated relays; boost one's score.
      for (var i = 0; i < 5; i++) {
        t.recordConnectSuccess('wss://relay.damus.io');
      }
      final ranked = t.ranked(['wss://nos.lol', 'wss://relay.damus.io']);
      expect(ranked.first, 'wss://relay.damus.io');
    });

    test('topK keeps platform + fills to K with the healthiest', () {
      final t = RelayHealthTracker();
      // A platform relay + several curated, one clearly healthiest.
      for (var i = 0; i < 5; i++) {
        t.recordConnectSuccess('wss://relay.damus.io');
      }
      final top = t.topK([
        'wss://relay.nostrfeed.com', // platform
        'wss://relay.damus.io', // healthiest curated
        'wss://nos.lol',
        'wss://relay.primal.net',
        'wss://nostr.mom',
        'wss://offchain.pub',
      ], k: 4);
      expect(top.length, 4);
      expect(top, contains('wss://relay.nostrfeed.com')); // platform always in
      expect(top, contains('wss://relay.damus.io')); // healthiest makes it
    });

    test('topK with fewer candidates than K returns all of them', () {
      final t = RelayHealthTracker();
      final top = t.topK(['wss://a.example', 'wss://b.example'], k: 4);
      expect(top.length, 2);
    });
  });

  group('persistence', () {
    test('health persists to relay_health + reloads into a fresh tracker', () async {
      final t1 = RelayHealthTracker();
      t1.recordConnectSuccess('wss://relay.damus.io');
      t1.recordEose('wss://relay.damus.io', 300);
      await t1.flush(); // force the debounced persist

      final t2 = RelayHealthTracker();
      await t2.load();
      final h = t2.healthOf('wss://relay.damus.io');
      expect(h, isNotNull);
      expect(h!.successCount, greaterThan(0));
      expect(h.score, greaterThan(0));
      expect(h.lastEoseMs, 300);
    });
  });

  group('author_relays (outbox affinity)', () {
    test('recordAuthorRelay increments + authorRelaysFor ranks by activity', () async {
      final store = EventStore.instance;
      final author = 'ab' * 32;
      await store.recordAuthorRelay(author, 'wss://r1.example');
      await store.recordAuthorRelay(author, 'wss://r1.example');
      await store.recordAuthorRelay(author, 'wss://r2.example');
      final relays = await store.authorRelaysFor(author);
      expect(relays.first, 'wss://r1.example'); // 2 events > 1
      expect(relays, containsAll(['wss://r1.example', 'wss://r2.example']));
    });
  });
}
