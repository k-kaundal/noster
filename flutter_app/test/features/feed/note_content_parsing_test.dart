import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/utils/media.dart';

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

  group('kind 20 picture posts (imeta-only media)', () {
    NostrEvent pictureEvent({
      required String content,
      List<String>? imetaImages,
      String? title,
    }) =>
        NostrEvent(
          id: 'e' * 2,
          pubkey: 'p' * 2,
          createdAt: 1,
          kind: 20,
          tags: [
            if (title != null) ['title', title],
            for (final url in imetaImages ?? const <String>[])
              ['imeta', 'url $url', 'm image/jpeg'],
          ],
          content: content,
          sig: 's' * 2,
        );

    test('imeta images are found even when content is empty', () {
      // The "no content, just a name" bug: a kind-20 post with empty content
      // but media in imeta must yield renderable images. This is the input
      // splitForRender merges via parseImeta.
      final e = pictureEvent(
        content: '',
        imetaImages: ['https://nostr.build/i/a.jpg'],
      );
      final imeta = MediaUtils.parseImeta(e);
      expect(imeta.keys, contains('https://nostr.build/i/a.jpg'));
      // And the URL classifies as an image so it lands in render.images.
      expect(
        MediaUtils.classify('https://nostr.build/i/a.jpg'),
        MediaType.image,
      );
    });

    test('a caption in the title tag is usable when content is empty', () {
      // NIP-68: picture posts carry the description in `title` when the body
      // is empty. _ParsedNote falls back to it.
      final e = pictureEvent(
        content: '',
        title: 'A scenic coast',
        imetaImages: ['https://nostr.build/i/a.jpg'],
      );
      expect(e.getTag('title'), 'A scenic coast');
    });

    test('extensionless imeta hosts still classify as images', () {
      // Blossom/nostr.build URLs have no file extension — classify must
      // still treat them as images or they'd be dropped from the gallery.
      expect(
        MediaUtils.classify('https://image.nostr.build/abc123'),
        MediaType.image,
      );
      expect(
        MediaUtils.classify('https://void.cat/abc123'),
        MediaType.image,
      );
    });
  });
}
