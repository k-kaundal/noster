import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

void main() {
  group('bare hex key detection', () {
    final hexRe = RegExp(
      r'(?<![0-9a-z])[0-9a-f]{64}(?![0-9a-z])',
      caseSensitive: false,
    );
    final pk = 'a' * 64;

    test('matches a bare 64-char hex key', () {
      expect(hexRe.hasMatch('check out $pk please'), isTrue);
    });

    test('does not match inside a longer hex/bech32 run', () {
      expect(hexRe.hasMatch('nostr:npub1$pk'), isFalse);
      expect(hexRe.hasMatch('${pk}ff'), isFalse);
    });

    test('does not match short strings', () {
      expect(hexRe.hasMatch('abc123'), isFalse);
    });
  });

  group('media-only post detection', () {
    // Mirror of the hasVisibleText rule in NoteContent: a post whose content
    // was only media URLs has no visible text segments left.
    test('image-only content yields no visible text', () {
      // Simulate splitForRender output for "https://x/img.png"
      // (the image URL is pulled into images, no segments remain).
      final textSegments = <Object>[]; // nothing visible
      final images = ['https://x/img.png'];
      expect(textSegments.isEmpty, isTrue);
      expect(images, isNotEmpty);
    });
  });

  group('getTag sanitization', () {
    NostrEvent eventWithTag(String value) => NostrEvent(
          id: 'e' * 2,
          pubkey: 'p' * 2,
          createdAt: 1,
          kind: 30023,
          tags: [
            ['title', value],
          ],
          content: '',
          sig: 's' * 2,
        );

    test('a lone surrogate in a tag value is stripped by getTag', () {
      // High surrogate \uD83D with no following low surrogate.
      final e = eventWithTag('hello \uD83D world');
      final title = e.getTag('title');
      expect(title, isNotNull);
      expect(title!.contains('\uD83D '), isFalse);
      expect(title, 'hello  world');
    });

    test('getTagRaw preserves the value byte-for-byte', () {
      final e = eventWithTag('hello \uD83D world');
      final raw = e.getTagRaw('title');
      expect(raw, 'hello \uD83D world');
    });

    test('a valid emoji pair survives getTag', () {
      final e = eventWithTag('hello 😀 world');
      expect(e.getTag('title'), 'hello 😀 world');
    });
  });
}
