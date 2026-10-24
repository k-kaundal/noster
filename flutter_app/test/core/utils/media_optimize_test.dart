import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/utils/media.dart';

void main() {
  group('MediaUtils.optimizedImageUrl (CDN resize)', () {
    test('nostr.build hosts get a ?w= resize param', () {
      expect(
        MediaUtils.optimizedImageUrl('https://image.nostr.build/abc.jpg'),
        contains('w=1080'),
      );
      expect(
        MediaUtils.optimizedImageUrl('https://blossom.band/abc', width: 192),
        contains('w=192'),
      );
    });

    test('an already-resized URL is not double-parametrized', () {
      final u = MediaUtils.optimizedImageUrl(
        'https://nostr.build/i/xyz.png?w=720',
      );
      expect(u, 'https://nostr.build/i/xyz.png?w=720');
    });

    test('non-CDN hosts are returned unchanged', () {
      expect(
        MediaUtils.optimizedImageUrl('https://void.cat/abc.jpg'),
        'https://void.cat/abc.jpg',
      );
    });

    test('a custom width is honored (avatars, banners)', () {
      expect(
        MediaUtils.optimizedImageUrl(
          'https://image.nostr.build/p.jpg',
          width: 1200,
        ),
        contains('w=1200'),
      );
    });
  });
}
