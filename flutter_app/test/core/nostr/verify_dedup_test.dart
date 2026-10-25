import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';

void main() {
  group('RelayPool cross-relay verify dedup (C4)', () {
    test('markVerified: first copy verifies, later copies skip', () {
      final pool = RelayPool(relays: const []);
      final id = 'ab' * 32;

      // First sighting of an id: must verify (returns false).
      expect(pool.markVerified(id), isFalse);
      // Same id again (second relay delivering the same event): skip crypto.
      expect(pool.markVerified(id), isTrue);
      expect(pool.markVerified(id), isTrue);
    });

    test('different ids all verify on first sight', () {
      final pool = RelayPool(relays: const []);
      for (var i = 0; i < 10; i++) {
        expect(pool.markVerified('id$i'), isFalse);
      }
      // And all of them are now known.
      for (var i = 0; i < 10; i++) {
        expect(pool.markVerified('id$i'), isTrue);
      }
    });

    test('cap evicts oldest (LRU bound)', () {
      final pool = RelayPool(relays: const []);
      // Fill past the 5000 cap.
      for (var i = 0; i < 5001; i++) {
        pool.markVerified('e$i');
      }
      // The oldest entry was evicted — it verifies again.
      expect(pool.markVerified('e0'), isFalse);
      // The newest entries are still known.
      expect(pool.markVerified('e5000'), isTrue);
    });
  });
}
