import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_thread_provider.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

const _me =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _peer =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

AuthState _authed() => const AuthState(
      pubkey: _me,
      privateKey:
          '1111111111111111111111111111111111111111111111111111111111111111',
      isLoggedIn: true,
    );

ProviderContainer _makeContainer() {
  SharedPreferences.setMockInitialValues({});
  final c = ProviderContainer();
  c.read(authStateProvider.notifier).state = _authed();
  return c;
}

Future<void> _seedMessages(int count) async {
  final base = 1000000;
  for (var i = 0; i < count; i++) {
    await EventStore.instance.upsertDmMessage(
      DbMessage(
        id: 'm$i',
        peer: _peer,
        direction:
            i.isEven ? DbDmDirection.incoming : DbDmDirection.outgoing,
        content: 'message $i',
        createdAt: base + i * 60, // one per minute, ascending
        wrapKind: 1059,
        rumorKind: 14,
        status: DbMessageStatus.sent,
      ),
    );
  }
}

void main() {
  sqfliteFfiInit();

  Future<void> openCurrent() async {
    EventStore.debugOpenOverride = () => databaseFactoryFfi.openDatabase(
          inMemoryDatabasePath,
          options: OpenDatabaseOptions(
            version: 5,
            onCreate: (db, v) async {
              await EventStore.debugCreateV1(db);
              await EventStore.debugOnUpgrade(db, 1, 5);
            },
          ),
        );
  }

  setUp(() async {
    await EventStore.instance.debugReset();
    await openCurrent();
  });

  tearDown(() async {
    EventStore.debugOpenOverride = null;
    await EventStore.instance.debugReset();
  });

  group('DmHistoryNotifier (store leg)', () {
    test(
      'loadOlder pages the store newest→oldest with a strict until cursor',
      () async {
        await _seedMessages(120);
        final c = _makeContainer();
        addTearDown(c.dispose);
        // Keep the autoDispose provider alive for the whole test (a bare
        // container.read lets it dispose between reads → state resets).
        final sub = c.listen(
          dmHistoryProvider(_peer),
          (_, __) {},
        );
        addTearDown(sub.close);
        final notifier = c.read(dmHistoryProvider(_peer).notifier);

        // Newest visible ts: the newest message (base + 119*60 = 1007140).
        // First page should return the 50 just BELOW it.
        await notifier.loadOlder(1007140);
        var s = c.read(dmHistoryProvider(_peer));
        expect(s.older, hasLength(50));
        expect(s.hasMore, isTrue);
        expect(s.older.first.createdAt, lessThan(1007140));
        // Newest-first ordering inside the page.
        expect(
          s.older.first.createdAt,
          greaterThan(s.older.last.createdAt),
        );

        // Second page continues strictly below the page-1 oldest — no
        // overlap (the strict `<` keyset cursor).
        await notifier.loadOlder(s.older.last.createdAt);
        s = c.read(dmHistoryProvider(_peer));
        expect(s.older, hasLength(100));
        final ids = s.older.map((m) => m.id).toSet();
        expect(ids.length, 100, reason: 'pages must not overlap');

        // Third page: the last 19 land → hasMore flips false. (119 total,
        // not 120: the cursor message at ts=1007140 is the LIVE window's
        // newest — the strict `<` keyset correctly excludes it from history.)
        await notifier.loadOlder(s.older.last.createdAt);
        s = c.read(dmHistoryProvider(_peer));
        expect(s.older, hasLength(119));
        expect(s.hasMore, isFalse);
      },
    );

    test('loadOlder is a no-op while loading or at end of history', () async {
      await _seedMessages(5);
      final c = _makeContainer();
      addTearDown(c.dispose);
      final sub = c.listen(dmHistoryProvider(_peer), (_, __) {});
      addTearDown(sub.close);
      final notifier = c.read(dmHistoryProvider(_peer).notifier);

      // Load everything (page of 50 swallows all 5 → hasMore false after
      // the relay leg finds nothing... relay leg is offline in tests, so
      // hasMore ends false via the short page rule).
      await notifier.loadOlder(1000000 + 5 * 60);
      var s = c.read(dmHistoryProvider(_peer));
      expect(s.older, hasLength(5));

      final countAfterFirst = s.older.length;
      // Second call at end-of-history: no new messages appended.
      await notifier.loadOlder(s.older.last.createdAt);
      s = c.read(dmHistoryProvider(_peer));
      expect(s.older.length, countAfterFirst);
    });

    test('dedupes against already-loaded messages', () async {
      await _seedMessages(60);
      final c = _makeContainer();
      addTearDown(c.dispose);
      final sub = c.listen(dmHistoryProvider(_peer), (_, __) {});
      addTearDown(sub.close);
      final notifier = c.read(dmHistoryProvider(_peer).notifier);

      // Overlapping cursors on purpose: page 1 then a cursor INSIDE page 1.
      await notifier.loadOlder(1007140);
      final firstLen = c.read(dmHistoryProvider(_peer)).older.length;
      await notifier.loadOlder(1005000); // overlaps page 1
      final s = c.read(dmHistoryProvider(_peer));
      final ids = s.older.map((m) => m.id).toSet();
      expect(ids.length, s.older.length, reason: 'no duplicate ids');
      expect(s.older.length, greaterThanOrEqualTo(firstLen));
    });
  });
}
