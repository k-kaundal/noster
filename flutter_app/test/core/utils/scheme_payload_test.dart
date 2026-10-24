import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/utils/encrypted_content.dart';

void main() {
  group('decodeSchemePayload (bala:// call offer)', () {
    // The exact content from the user report — a bala:// WebRTC call offer.
    const bala =
        'bala://offer/eyJuYW1lIjoi0JLQstC10LTQuNGC0LUg0LjQvNGPIiwicm9vbSI6Ijg1NjY5NyIsImNhbmRpZGF0ZXMiOlsiMTkyLjE2OC4xLjEwNjo2NDQ5NyIsIjk0LjE5LjE3OC41MTo2NDQ5NyJdLCJob3N0X2lkIjoxfQ';

    test('decodes scheme, action, and JSON payload', () {
      final p = decodeSchemePayload(bala);
      expect(p, isNotNull);
      expect(p!.scheme, 'bala');
      expect(p.action, 'offer');
      expect(p.json, isNotNull);
      expect(p.json!['room'], '856697');
      expect(p.json!['name'], 'Введите имя');
      expect((p.json!['candidates'] as List).length, 2);
    });

    test('summary surfaces room + candidate count', () {
      final p = decodeSchemePayload(bala)!;
      expect(p.summary, contains('room 856697'));
      expect(p.summary, contains('2 connection candidates'));
    });

    test('classifies as schemePayload, not ciphertext', () {
      expect(classifyEncrypted(bala), EncryptedKind.schemePayload);
    });

    test('an https URL is NOT a scheme payload', () {
      expect(
        decodeSchemePayload('https://nostr.build/i/abc123def456'),
        isNull,
      );
    });
  });

  group('future-timestamp ordering clamp', () {
    // Mirror of FeedNotifier._orderTs: a future-dated post orders as "now",
    // not as "top of all time" (the stuck-on-top bug).
    int orderTs(int createdAt, int now) {
      const tolerance = 15 * 60;
      final cap = now + tolerance;
      return createdAt > cap ? now : createdAt;
    }

    test('a far-future post clamps to now', () {
      final now = 1700000000;
      final future = now + 365 * 24 * 3600; // a year ahead
      expect(orderTs(future, now), now);
    });

    test('a post within tolerance keeps its timestamp', () {
      final now = 1700000000;
      final soon = now + 5 * 60; // 5 min ahead — clock skew, allowed
      expect(orderTs(soon, now), soon);
    });

    test('a normal past post keeps its timestamp', () {
      final now = 1700000000;
      final past = now - 3600;
      expect(orderTs(past, now), past);
    });
  });
}
