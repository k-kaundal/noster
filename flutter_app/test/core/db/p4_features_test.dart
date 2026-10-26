import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0008 P4: FTS5 people search + media metadata + publish outbox + DM
/// full-text search.
void main() {
  sqfliteFfiInit();

  Future<void> openCurrent() async {
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

  final alice = 'aa' * 32;
  final bob = 'bb' * 32;
  final carol = 'cc' * 32;

  NostrProfile prof({
    String? name,
    String? displayName,
    String? nip05,
    String? about,
  }) =>
      NostrProfile(
        name: name,
        displayName: displayName,
        nip05: nip05,
        about: about,
      );

  setUp(() async {
    await EventStore.instance.debugReset();
    await openCurrent();
  });

  tearDown(() {
    EventStore.debugOpenOverride = null;
    return EventStore.instance.debugReset();
  });

  group('FTS5 people search', () {
    test('saveProfile indexes + searchProfiles finds by name', () async {
      final store = EventStore.instance;
      await store.saveProfile(alice, prof(name: 'alice', displayName: 'Alice W'));
      await store.saveProfile(bob, prof(name: 'bob', displayName: 'Builder Bob'));
      final hits = await store.searchProfiles('alice');
      expect(hits.map((h) => h.pubkey), contains(alice));
      expect(hits.map((h) => h.pubkey), isNot(contains(bob)));
    });

    test('FTS matches display_name + nip05 + about (not just name)', () async {
      final store = EventStore.instance;
      await store.saveProfile(carol, prof(
        name: 'x',
        displayName: 'Zap Master',
        nip05: 'zap@example.com',
        about: 'I love lightning and bitcoin',
      ));
      expect((await store.searchProfiles('zap')).map((h) => h.pubkey), contains(carol));
      expect((await store.searchProfiles('lightning')).map((h) => h.pubkey), contains(carol));
    });

    test('prefix search works (FTS token prefix)', () async {
      final store = EventStore.instance;
      await store.saveProfile(alice, prof(name: 'alexandra'));
      // "alex" should prefix-match "alexandra" via FTS.
      final hits = await store.searchProfiles('alex');
      expect(hits.map((h) => h.pubkey), contains(alice));
    });

    test('a profile update re-indexes (stale name no longer matches)', () async {
      final store = EventStore.instance;
      await store.saveProfile(alice, prof(name: 'oldname'));
      await store.saveProfile(alice, prof(name: 'newname'));
      expect((await store.searchProfiles('newname')).map((h) => h.pubkey), contains(alice));
      // FTS index was replaced (the old name row was deleted on update).
      if (EventStore.instance.ftsAvailable) {
        expect((await store.searchProfiles('oldname')).map((h) => h.pubkey),
            isNot(contains(alice)));
      }
    });

    test('empty / whitespace query returns nothing', () async {
      final store = EventStore.instance;
      await store.saveProfile(alice, prof(name: 'alice'));
      expect(await store.searchProfiles('   '), isEmpty);
    });
  });

  group('media metadata', () {
    DbMedia m(String url, {String? eventId, int? w, int? h, String? bh}) =>
        DbMedia(
          url: url,
          eventId: eventId,
          kind: DbMediaKind.image,
          width: w,
          height: h,
          blurhash: bh,
        );

    test('upsertMedia + mediaFor returns dims/blurhash (layout-before-load)', () async {
      final store = EventStore.instance;
      await store.upsertMedia(m('https://x/img.jpg', w: 800, h: 600, bh: 'LABC'));
      final got = await store.mediaFor('https://x/img.jpg');
      expect(got, isNotNull);
      expect(got!.width, 800);
      expect(got.height, 600);
      expect(got.blurhash, 'LABC');
    });

    test('mediaForEvent returns a gallery\'s whole imeta set', () async {
      final store = EventStore.instance;
      final ev = 'dd' * 32;
      await store.upsertMediaBatch([
        m('https://x/1.jpg', eventId: ev, w: 100, h: 100),
        m('https://x/2.jpg', eventId: ev, w: 200, h: 200),
      ]);
      final gallery = await store.mediaForEvent(ev);
      expect(gallery.length, 2);
    });

    test('upsert is idempotent (re-parse replaces, no dup)', () async {
      final store = EventStore.instance;
      await store.upsertMedia(m('https://x/img.jpg', w: 100, h: 100));
      await store.upsertMedia(m('https://x/img.jpg', w: 500, h: 500));
      expect((await store.mediaFor('https://x/img.jpg'))!.width, 500);
    });
  });

  group('publish_outbox (durable retry)', () {
    DbPublishJob job(String id, int ts) => DbPublishJob(
          id: id,
          eventJson: '{"id":"$id"}',
          targets: const ['wss://relay.nostrfeed.com'],
          createdAt: ts,
        );

    test('enqueue + pending + state transitions', () async {
      final store = EventStore.instance;
      await store.enqueuePublishJob(job('p1', 100));
      await store.enqueuePublishJob(job('p2', 200));
      var pending = await store.publishJobsPending();
      expect(pending.map((j) => j.id).toList(), ['p1', 'p2']); // oldest first

      await store.updatePublishJobState('p1', DbPublishState.sent);
      pending = await store.publishJobsPending();
      expect(pending.map((j) => j.id).toList(), ['p2']);

      await store.removePublishJob('p2');
      expect(await store.publishJobsPending(), isEmpty);
    });

    test('retry bumps attempts + records last_error', () async {
      final store = EventStore.instance;
      await store.enqueuePublishJob(job('p1', 100));
      await store.updatePublishJobState('p1', DbPublishState.failed,
          bumpAttempts: true, lastError: 'socket dead');
      final p = (await store.publishJobsPending()).single;
      expect(p.attempts, 1);
      expect(p.state, DbPublishState.failed);
      expect(p.lastError, 'socket dead');
    });
  });

  group('DM full-text search', () {
    DbMessage msg(String id, String content, int ts, {String? peer}) =>
        DbMessage(
          id: id,
          peer: peer ?? bob,
          direction: DbDmDirection.incoming,
          content: content,
          createdAt: ts,
        );

    test('searches decrypted plaintext (global)', () async {
      final store = EventStore.instance;
      await store.upsertDmMessage(msg('m1', 'meet at the park tomorrow', 100));
      await store.upsertDmMessage(msg('m2', 'send the invoice please', 200));
      final hits = await store.searchDmMessages('park');
      expect(hits.map((x) => x.id), ['m1']);
    });

    test('scopes to one peer\'s thread', () async {
      final store = EventStore.instance;
      await store.upsertDmMessage(msg('a1', 'hello park', 100, peer: bob));
      await store.upsertDmMessage(msg('a2', 'hello park', 200, peer: carol));
      final hits = await store.searchDmMessages('park', peer: carol);
      expect(hits.map((x) => x.id), ['a2']);
    });

    test('empty query returns nothing', () async {
      final store = EventStore.instance;
      await store.upsertDmMessage(msg('m1', 'anything', 100));
      expect(await store.searchDmMessages('  '), isEmpty);
    });
  });
}
