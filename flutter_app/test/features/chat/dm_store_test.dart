import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
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
  });
}
