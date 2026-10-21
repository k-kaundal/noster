import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/features/chat/providers/dm_store.dart';

const _me = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _peer = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

AuthState _authed() => const AuthState(
      pubkey: _me,
      privateKey: '1111111111111111111111111111111111111111111111111111111111111111',
      isLoggedIn: true,
    );

NostrEvent _kind4({
  required String id,
  required String from,
  required String to,
  int createdAt = 1000,
}) =>
    NostrEvent(
      id: id,
      pubkey: from,
      createdAt: createdAt,
      kind: 4,
      tags: [
        ['p', to],
      ],
      content: 'cipher',
      sig: 'sig',
    );

ProviderContainer _makeContainer() {
  // Mock secure/prefs storage so AuthNotifier._init's getStoredAuth resolves
  // to logged-out quickly — and our explicit state set isn't overwritten.
  SharedPreferences.setMockInitialValues({});
  final c = ProviderContainer();
  c.read(authStateProvider.notifier).state = _authed();
  return c;
}

void main() {
  group('DmStore', () {
    test('recordSent adds a pending message to the thread', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final store = c.read(dmStoreProvider);

      store.recordSent(peerPubkey: _peer, plaintext: 'gm', eventId: 'ev1');

      final thread = store.threadFor(const [], _peer);
      expect(thread, hasLength(1));
      expect(thread.single.text, 'gm');
      expect(thread.single.senderPubkey, _me);
      expect(thread.single.isPending, isTrue);
    });

    test('threadFor merges outbox with kind-4 events, newest first', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final store = c.read(dmStoreProvider);

      final old = _kind4(id: 'e1', from: _peer, to: _me, createdAt: 500);
      store.recordSent(peerPubkey: _peer, plaintext: 'just sent', eventId: 'e2');

      final thread = store.threadFor([old], _peer);
      expect(thread, hasLength(2));
      // Outbox message has a current timestamp → sorts before the old one.
      expect(thread.first.text, 'just sent');
    });

    test('kind-4 from someone else is not in my thread with peer', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final store = c.read(dmStoreProvider);

      final other = _kind4(id: 'e1', from: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', to: _me, createdAt: 500);
      expect(store.threadFor([other], _peer), isEmpty);
    });

    test('conversations includes outbox-only peers', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final store = c.read(dmStoreProvider);

      store.recordSent(peerPubkey: _peer, plaintext: 'hi', eventId: 'e1');
      final convs = store.conversations(const []);
      expect(convs, hasLength(1));
      expect(convs.single.peer, _peer);
      expect(convs.single.decrypted?.plaintext, 'hi');
    });

    test('clearOutbox removes pending messages for that peer only', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final store = c.read(dmStoreProvider);

      store.recordSent(peerPubkey: _peer, plaintext: 'a', eventId: 'e1');
      store.recordSent(peerPubkey: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', plaintext: 'b', eventId: 'e2');
      store.clearOutbox(_peer);

      expect(store.threadFor(const [], _peer), isEmpty);
      expect(store.threadFor(const [], 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'), hasLength(1));
    });

    test('recordSent no-ops when logged out', () {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      final store = c.read(dmStoreProvider);
      store.recordSent(peerPubkey: _peer, plaintext: 'x', eventId: 'e1');
      expect(store.threadFor(const [], _peer), isEmpty);
    });

    group('delivery status', () {
      test('recordSent returns the local id; markStatus flips pending→sent', () {
        final c = _makeContainer();
        addTearDown(c.dispose);
        final store = c.read(dmStoreProvider);

        final id =
            store.recordSent(peerPubkey: _peer, plaintext: 'gm', eventId: 'e1');
        expect(id, isNotEmpty);
        expect(store.threadFor(const [], _peer).single.status,
            MessageStatus.pending);

        store.markStatus(_peer, id, MessageStatus.sent);
        expect(store.threadFor(const [], _peer).single.status,
            MessageStatus.sent);
        expect(store.threadFor(const [], _peer).single.isPending, isFalse);
      });

      test('markStatus on unknown id is a safe no-op', () {
        final c = _makeContainer();
        addTearDown(c.dispose);
        final store = c.read(dmStoreProvider);
        store.markStatus(_peer, 'nope', MessageStatus.sent);
        expect(store.threadFor(const [], _peer), isEmpty);
      });

      test('removePending deletes a failed message', () {
        final c = _makeContainer();
        addTearDown(c.dispose);
        final store = c.read(dmStoreProvider);
        final id =
            store.recordSent(peerPubkey: _peer, plaintext: 'x', eventId: 'e1');
        store.markStatus(_peer, id, MessageStatus.failed);
        store.removePending(_peer, id);
        expect(store.threadFor(const [], _peer), isEmpty);
      });
    });

    group('unread tracking', () {
      test('incoming kind-4 counts as unread until thread is read', () async {
        final c = _makeContainer();
        addTearDown(c.dispose);
        final store = c.read(dmStoreProvider);
        await store.ready;

        final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
        final incoming =
            _kind4(id: 'e1', from: _peer, to: _me, createdAt: now);
        // Prime the decryption cache — totalUnread walks conversations(),
        // which needs decrypted kind-4s to attribute peers.
        await store.prime([incoming]);
        expect(store.unreadFor([incoming], _peer), 1);
        expect(store.totalUnread([incoming]), 1);

        // Marking read with the thread's newest ts clears it (this is how the
        // chat screen calls it — covers backdated NIP-17 timestamps).
        await store.markThreadRead(_peer, latestKnownTs: now);
        expect(store.unreadFor([incoming], _peer), 0);
        expect(store.totalUnread([incoming]), 0);
      });

      test('my own messages are never unread', () async {
        final c = _makeContainer();
        addTearDown(c.dispose);
        final store = c.read(dmStoreProvider);
        await store.ready;

        final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
        final mine = _kind4(id: 'e1', from: _me, to: _peer, createdAt: now);
        expect(store.unreadFor([mine], _peer), 0);
      });

      test('old messages before lastRead are not unread', () async {
        final c = _makeContainer();
        addTearDown(c.dispose);
        final store = c.read(dmStoreProvider);
        await store.ready;

        await store.markThreadRead(_peer);
        final old = _kind4(id: 'e1', from: _peer, to: _me, createdAt: 100);
        expect(store.unreadFor([old], _peer), 0);
      });

      test('live-ingested kind-4 arrives with arrival timestamp and unread', () async {
        final c = _makeContainer();
        addTearDown(c.dispose);
        final store = c.read(dmStoreProvider);
        await store.ready;

        // Simulate a message arriving via the live subscription AFTER the
        // thread was already read — must count as unread via arrival time.
        await store.markThreadRead(_peer);
        final live =
            _kind4(id: 'live1', from: _peer, to: _me, createdAt: 100);
        await store.ingest(live);

        expect(store.arrivalTsOf('live1'), isNotNull);
        expect(store.unreadFor(const [], _peer), 1);
        expect(store.threadFor(const [], _peer), hasLength(1));
      });

      test('marking read clamps live events — no re-notify on re-delivery', () async {
        final c = _makeContainer();
        addTearDown(c.dispose);
        final store = c.read(dmStoreProvider);
        await store.ready;

        // A message arrives live → unread = 1.
        final live = _kind4(id: 'clamp1', from: _peer, to: _me, createdAt: 100);
        await store.ingest(live);
        expect(store.unreadFor(const [], _peer), 1);

        // User opens the thread → marked read → unread = 0.
        await store.markThreadRead(_peer);
        expect(store.unreadFor(const [], _peer), 0);

        // The live subscription re-delivers the SAME event (arrival would be
        // "now" again) — must NOT re-count as unread (the "opening chat
        // re-notifies" bug).
        expect(store.isUnreadFrom(_peer, live, 100), isFalse);
        expect(store.unreadFor(const [], _peer), 0);
      });

      test('live-ingested messages show arrival time, not backdated created_at', () async {
        final c = _makeContainer();
        addTearDown(c.dispose);
        final store = c.read(dmStoreProvider);
        await store.ready;

        // NIP-17 backdates created_at up to 2 days — display must use arrival.
        final backdated = _kind4(id: 'ts1', from: _peer, to: _me, createdAt: 100);
        await store.ingest(backdated);
        final thread = store.threadFor(const [], _peer);
        expect(thread, hasLength(1));
        expect(thread.single.createdAt, greaterThan(1000));
      });

      test('ingest ignores duplicate and wrong-kind events', () async {
        final c = _makeContainer();
        addTearDown(c.dispose);
        final store = c.read(dmStoreProvider);
        await store.ready;

        final live =
            _kind4(id: 'dup1', from: _peer, to: _me, createdAt: 100);
        await store.ingest(live);
        await store.ingest(live); // duplicate — no crash, still one
        expect(store.threadFor(const [], _peer), hasLength(1));

        final kind1 = NostrEvent(
          id: 'k1',
          pubkey: _peer,
          createdAt: 100,
          kind: 1,
          tags: const [],
          content: 'not a dm',
          sig: 'sig',
        );
        await store.ingest(kind1); // wrong kind — ignored
        expect(store.arrivalTsOf('k1'), isNull);
      });
    });
  });
}
