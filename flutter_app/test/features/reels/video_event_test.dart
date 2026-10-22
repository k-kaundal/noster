import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';

void main() {
  ProviderContainer makeContainer() {
    SharedPreferences.setMockInitialValues({});
    final c = ProviderContainer();
    final auth = AuthService();
    final kp = auth.generateEphemeralKeypair();
    c.read(authStateProvider.notifier).state = AuthState(
      pubkey: kp.pub,
      privateKey: kp.priv,
      isLoggedIn: true,
    );
    final nostr = c.read(nostrServiceProvider);
    nostr.setAuth(c.read(authStateProvider));
    return c;
  }

  group('createVideoEvent (NIP-71)', () {
    test('kind 22 short-form with full imeta metadata', () {
      final c = makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final event = nostr.createVideoEvent(
        url: 'https://b.nostr.build/abc.mp4',
        mimeType: 'video/mp4',
        caption: 'My first reel #nostr',
        posterUrl: 'https://b.nostr.build/abc.mp4?poster',
        durationSec: 29.5,
        hashtags: ['nostr'],
      );

      expect(event.kind, 22);
      expect(event.content, 'My first reel #nostr');
      expect(event.getTag('title'), 'My first reel #nostr');
      expect(event.getTag('published_at'), isNotNull);

      final imeta = event.tags.firstWhere((t) => t[0] == 'imeta');
      expect(imeta.any((p) => p == 'url https://b.nostr.build/abc.mp4'), isTrue);
      expect(imeta.any((p) => p == 'm video/mp4'), isTrue);
      expect(imeta.any((p) => p == 'image https://b.nostr.build/abc.mp4?poster'), isTrue);
      expect(imeta.any((p) => p.startsWith('duration ')), isTrue);

      expect(event.getTags('t'), contains('nostr'));
    });

    test('kind 21 landscape when isShortForm=false', () {
      final c = makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final event = nostr.createVideoEvent(
        url: 'https://x.com/v.mp4',
        mimeType: 'video/mp4',
        isShortForm: false,
      );
      expect(event.kind, 21);
    });

    test('omits poster + duration when absent', () {
      final c = makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final event = nostr.createVideoEvent(
        url: 'https://x.com/v.mp4',
        mimeType: 'video/mp4',
      );
      final imeta = event.tags.firstWhere((t) => t[0] == 'imeta');
      expect(imeta.any((p) => p.startsWith('image ')), isFalse);
      expect(imeta.any((p) => p.startsWith('duration ')), isFalse);
    });
  });
}
