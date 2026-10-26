import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/filter.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// Hashtag queries (Explore → tap a tag): case-insensitive `#t` matching the
/// way real relays answer it, in BOTH the store's SQL index and the compiled
/// filter engine.
void main() {
  sqfliteFfiInit();

  String h(int byte) => (byte.toRadixString(16).padLeft(2, '0')) * 32;

  NostrEvent tagged({
    required String id,
    required String hashtag,
    int createdAt = 1000,
  }) => NostrEvent(
    id: id,
    pubkey: h(9),
    createdAt: createdAt,
    kind: 1,
    tags: [
      ['t', hashtag],
    ],
    content: 'post about $hashtag',
    sig: 'c' * 128,
  );

  setUp(() async {
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
    await EventStore.instance.debugReset();
  });

  tearDown(() async {
    await EventStore.instance.debugReset();
    EventStore.debugOpenOverride = null;
  });

  group('store: #t tag index is case-insensitive', () {
    test('a `#Nostr` post answers a `#nostr` query', () async {
      final store = EventStore.instance;
      await store.ingest([
        tagged(id: h(1), hashtag: 'Nostr'),
        tagged(id: h(2), hashtag: 'nostr'),
        tagged(id: h(3), hashtag: 'NOSTR'),
        tagged(id: h(4), hashtag: 'bitcoin'),
      ]);

      final out = await store.queryByFilters([
        NostrFilter(
          kinds: [1],
          tagFilters: {
            't': ['nostr'],
          },
        ),
      ]);
      expect(out.map((e) => e.id).toSet(), {h(1), h(2), h(3)});
    });

    test('a `#nostr` post answers a `#NOSTR` query', () async {
      final store = EventStore.instance;
      await store.ingest([tagged(id: h(1), hashtag: 'nostr')]);
      final out = await store.queryByFilters([
        NostrFilter(
          tagFilters: {
            't': ['NOSTR'],
          },
        ),
      ]);
      expect(out.map((e) => e.id), [h(1)]);
    });

    test('other tags stay case-SENSITIVE (a d-tag is an identity)', () async {
      final store = EventStore.instance;
      await store.ingest([
        NostrEvent(
          id: h(1),
          pubkey: h(9),
          createdAt: 1000,
          kind: 30023,
          tags: [
            ['d', 'MyEssay'],
          ],
          content: 'x',
          sig: 'c' * 128,
        ),
      ]);
      final hit = await store.queryByFilters([
        NostrFilter(
          tagFilters: {
            'd': ['MyEssay'],
          },
        ),
      ]);
      expect(hit.length, 1);
      final miss = await store.queryByFilters([
        NostrFilter(
          tagFilters: {
            'd': ['myessay'],
          },
        ),
      ]);
      expect(miss, isEmpty); // identity tags must NOT fold case
    });
  });

  group('compiled filter: #t matches case-insensitively', () {
    test('event `#Nostr` vs filter `#nostr`', () {
      final f = CompiledFilter.from(
        NostrFilter(
          tagFilters: {
            't': ['nostr'],
          },
        ),
      );
      expect(f.matches(tagged(id: h(1), hashtag: 'Nostr')), isTrue);
      expect(f.matches(tagged(id: h(2), hashtag: 'bitcoin')), isFalse);
    });

    test('filter `#NOSTR` vs event `#nostr`', () {
      final f = CompiledFilter.from(
        NostrFilter(
          tagFilters: {
            't': ['NOSTR'],
          },
        ),
      );
      expect(f.matches(tagged(id: h(1), hashtag: 'nostr')), isTrue);
    });
  });
}
