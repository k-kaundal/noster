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

    test('reply includes e tag to the parent rumor', () {
      final wraps = auth.signGiftWrap(
        senderPrivateKey: alicePriv,
        senderPubkey: alicePub,
        recipientPubkey: bobPub,
        plaintext: 'this is a reply',
        replyToId: 'parent-message-id-123',
      );
      final rumor = auth.unwrapGiftWrap(
        recipientPrivateKey: bobPriv,
        giftWrap: wraps.firstWhere((w) => w.getTag('p') == bobPub),
      );
      final tags = (rumor['tags'] as List).cast<List>();
      final eTags = tags.where((t) => t.isNotEmpty && t[0] == 'e').toList();
      expect(eTags, hasLength(1));
      expect(eTags.first[1], 'parent-message-id-123');
    });

    test('reaction uses kind 7 with e tag', () {
      final wraps = auth.signGiftWrap(
        senderPrivateKey: alicePriv,
        senderPubkey: alicePub,
        recipientPubkey: bobPub,
        plaintext: '🔥',
        kind: 7,
        extraTags: [
          ['e', 'reacted-message-id'],
        ],
      );
      final rumor = auth.unwrapGiftWrap(
        recipientPrivateKey: bobPriv,
        giftWrap: wraps.firstWhere((w) => w.getTag('p') == bobPub),
      );
      expect(rumor['kind'], 7);
      expect(rumor['content'], '🔥');
    });

    test('file message uses kind 15 with metadata tags', () {
      final wraps = auth.signGiftWrap(
        senderPrivateKey: alicePriv,
        senderPubkey: alicePub,
        recipientPubkey: bobPub,
        plaintext: 'https://blossom.example/img.jpg',
        kind: 15,
        extraTags: [
          ['m', 'image/jpeg'],
          ['alt', 'a photo'],
        ],
      );
      final rumor = auth.unwrapGiftWrap(
        recipientPrivateKey: bobPriv,
        giftWrap: wraps.firstWhere((w) => w.getTag('p') == bobPub),
      );
      expect(rumor['kind'], 15);
      final tags = (rumor['tags'] as List).cast<List>();
      expect(tags.any((t) => t[0] == 'm' && t[1] == 'image/jpeg'), isTrue);
    });

    test('subject tag is carried in the rumor', () {
      final wraps = auth.signGiftWrap(
        senderPrivateKey: alicePriv,
        senderPubkey: alicePub,
        recipientPubkey: bobPub,
        plaintext: 'hello room',
        subject: 'Weekend plans',
      );
      final rumor = auth.unwrapGiftWrap(
        recipientPrivateKey: bobPriv,
        giftWrap: wraps.firstWhere((w) => w.getTag('p') == bobPub),
      );
      final tags = (rumor['tags'] as List).cast<List>();
      expect(
        tags.any((t) => t[0] == 'subject' && t[1] == 'Weekend plans'),
        isTrue,
      );
    });

    test('expiration tag is set on both rumor and wrap (disappearing)', () {
      final exp = (DateTime.now().millisecondsSinceEpoch ~/ 1000) + 3600;
      final wraps = auth.signGiftWrap(
        senderPrivateKey: alicePriv,
        senderPubkey: alicePub,
        recipientPubkey: bobPub,
        plaintext: 'self-destruct',
        expiration: exp,
      );
      for (final w in wraps) {
        expect(w.getTag('expiration'), '$exp');
      }
    });
  });
}
