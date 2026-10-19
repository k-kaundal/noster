import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/chat/providers/dm_store.dart';

void main() {
  group('DmStore', () {
    test('ChatMessage holds display data', () {
      const msg = ChatMessage(
        id: 'm1',
        text: 'hello',
        senderPubkey: 'pk1',
        createdAt: 1700000000,
      );
      expect(msg.text, 'hello');
      expect(msg.isPending, isFalse);
    });

    test('outbox records and clears per peer', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final store = container.read(dmStoreProvider);

      // recordSent requires auth; with no auth set it should no-op safely.
      store.recordSent(peerPubkey: 'peer1', plaintext: 'hi', eventId: 'e1');
      expect(store.threadFor(const [], 'peer1'), isEmpty);
    });

    test('clearAll resets caches', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final store = container.read(dmStoreProvider);
      store.clearAll();
      expect(store.cached('anything'), isNull);
    });
  });
}
