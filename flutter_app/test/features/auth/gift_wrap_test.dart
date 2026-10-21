import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('NIP-17 gift wrap round trip', () {
    final auth = AuthService();

    // Two real keypairs generated on-device.
    late String alicePriv, alicePub, bobPriv, bobPub;

    setUpAll(() {
      final a = auth.generateEphemeralKeypair();
      alicePriv = a.priv;
      alicePub = a.pub;
      final b = auth.generateEphemeralKeypair();
      bobPriv = b.priv;
      bobPub = b.pub;
    });

    test('recipient can decrypt the wrap addressed to them', () {
      final wraps = auth.signGiftWrap(
        senderPrivateKey: alicePriv,
        senderPubkey: alicePub,
        recipientPubkey: bobPub,
        plaintext: 'hello bob!',
      );
      expect(wraps, hasLength(2));

      final recipientWrap = wraps.firstWhere(
        (w) => w.getTag('p') == bobPub,
      );
      final rumor = auth.unwrapGiftWrap(
        recipientPrivateKey: bobPriv,
        giftWrap: recipientWrap,
      );
      expect(rumor['content'], 'hello bob!');
      expect(rumor['pubkey'], alicePub);
      expect(rumor['kind'], 14);
    });

    test('sender can decrypt their own copy', () {
      final wraps = auth.signGiftWrap(
        senderPrivateKey: alicePriv,
        senderPubkey: alicePub,
        recipientPubkey: bobPub,
        plaintext: 'my own copy',
      );
      final selfWrap = wraps.firstWhere((w) => w.getTag('p') == alicePub);
      final rumor = auth.unwrapGiftWrap(
        recipientPrivateKey: alicePriv,
        giftWrap: selfWrap,
      );
      expect(rumor['content'], 'my own copy');
      expect(rumor['pubkey'], alicePub);
    });

    test('a third party cannot decrypt either wrap', () {
      final c = auth.generateEphemeralKeypair();
      final wraps = auth.signGiftWrap(
        senderPrivateKey: alicePriv,
        senderPubkey: alicePub,
        recipientPubkey: bobPub,
        plaintext: 'secret',
      );
      for (final wrap in wraps) {
        expect(
          () => auth.unwrapGiftWrap(
            recipientPrivateKey: c.priv,
            giftWrap: wrap,
          ),
          throwsA(anything),
        );
      }
    });

    test('timestamps are randomized within ±2 days (metadata privacy)', () {
      final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      final wraps = auth.signGiftWrap(
        senderPrivateKey: alicePriv,
        senderPubkey: alicePub,
        recipientPubkey: bobPub,
        plaintext: 'ts check',
      );
      for (final w in wraps) {
        expect(w.createdAt, lessThanOrEqualTo(now));
        expect(w.createdAt, greaterThan(now - 172800 - 5));
      }
    });
  });
}
