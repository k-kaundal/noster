import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/utils/media.dart';

void main() {
  group('MediaUtils.classify', () {
    test('image extensions', () {
      for (final ext in ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif']) {
        expect(
          MediaUtils.classify('https://x.com/a.$ext'),
          MediaType.image,
          reason: ext,
        );
      }
    });

    test('video extensions + hosts', () {
      expect(MediaUtils.classify('https://x.com/a.mp4'), MediaType.video);
      expect(MediaUtils.classify('https://x.com/a.webm'), MediaType.video);
      expect(
        MediaUtils.classify('https://youtube.com/watch?v=abc'),
        MediaType.video,
      );
      expect(MediaUtils.classify('https://youtu.be/abc'), MediaType.video);
      expect(MediaUtils.classify('https://vimeo.com/123'), MediaType.video);
    });

    test('audio extensions', () {
      expect(MediaUtils.classify('https://x.com/a.mp3'), MediaType.audio);
    });

    test('extensionless media hosts → image', () {
      expect(
        MediaUtils.classify('https://blossom.primal.net/abc123'),
        MediaType.image,
      );
      expect(
        MediaUtils.classify('https://void.cat/d/xyz'),
        MediaType.image,
      );
      expect(
        MediaUtils.classify('https://nostr.build/i/foo'),
        MediaType.image,
      );
    });

    test('plain links → other', () {
      expect(
        MediaUtils.classify('https://example.com/article'),
        MediaType.other,
      );
    });
  });

  group('MediaUtils.parseImeta', () {
    NostrEvent eventWithImeta() => NostrEvent(
          id: 'e1',
          pubkey: 'pk',
          createdAt: 1000,
          kind: 1,
          tags: [
            [
              'imeta',
              'url https://nostr.build/i/a.jpg',
              'm image/jpeg',
              'dim 1200x800',
              'alt a nice photo',
              'blurhash ABC',
              'fallback https://void.cat/a.jpg',
            ],
          ],
          content: 'see https://nostr.build/i/a.jpg',
          sig: 'sig',
        );

    test('parses all fields', () {
      final map = MediaUtils.parseImeta(eventWithImeta());
      final info = map['https://nostr.build/i/a.jpg']!;
      expect(info.mimeType, 'image/jpeg');
      expect(info.dimensions, (1200, 800));
      expect(info.alt, 'a nice photo');
      expect(info.blurhash, 'ABC');
      expect(info.fallbackUrls, ['https://void.cat/a.jpg']);
    });

    test('aspectRatio computed from dimensions', () {
      final info =
          MediaUtils.parseImeta(eventWithImeta())['https://nostr.build/i/a.jpg']!;
      expect(info.aspectRatio, 1.5);
    });

    test('empty for events without imeta', () {
      final e = NostrEvent(
        id: 'e2',
        pubkey: 'pk',
        createdAt: 1,
        kind: 1,
        tags: const [],
        content: '',
        sig: 's',
      );
      expect(MediaUtils.parseImeta(e), isEmpty);
    });
  });

  group('MediaUtils.extractUrls', () {
    test('finds all http(s) URLs', () {
      final urls = MediaUtils.extractUrls(
        'check https://a.com/x and http://b.org/y?id=1 plus https://c.net',
      );
      expect(urls, hasLength(3));
    });
  });
}
