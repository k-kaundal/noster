import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_frame_processor.dart';

void main() {
  group('Cross-relay verify dedup (C4) — now in the frame processor LRU', () {
    // The dedup contract is unchanged from the old pool-level `markVerified`:
    // first copy of an id pays the Schnorr verify, later copies skip it —
    // but EVERY copy still dispatches (relay provenance). The LRU moved into
    // the worker isolate (`VerifyLru`), one per worker.
    test('checkAndMark: first copy verifies, later copies skip', () {
      final lru = VerifyLru(100);
      final id = 'ab' * 32;

      // First sighting of an id: must verify (returns false).
      expect(lru.checkAndMark(id), isFalse);
      // Same id again (second relay delivering the same event): skip crypto.
      expect(lru.checkAndMark(id), isTrue);
      expect(lru.checkAndMark(id), isTrue);
    });

    test('different ids all verify on first sight', () {
      final lru = VerifyLru(100);
      for (var i = 0; i < 10; i++) {
        expect(lru.checkAndMark('id$i'), isFalse);
      }
      // And all of them are now known.
      for (var i = 0; i < 10; i++) {
        expect(lru.checkAndMark('id$i'), isTrue);
      }
    });

    test('cap evicts oldest (LRU bound)', () {
      final lru = VerifyLru(5000);
      // Fill past the cap.
      for (var i = 0; i < 5001; i++) {
        lru.checkAndMark('e$i');
      }
      // The oldest entry was evicted — it verifies again.
      expect(lru.checkAndMark('e0'), isFalse);
      // The newest entries are still known.
      expect(lru.checkAndMark('e5000'), isTrue);
    });
  });
}
