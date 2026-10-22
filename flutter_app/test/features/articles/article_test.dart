import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';

void main() {
  group('createArticle (NIP-23 kind 30023)', () {
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

    test('has all NIP-23 required + recommended tags', () {
      final c = makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final event = nostr.createArticle(
        title: 'My Test Article',
        content: '# Hello\n\nThis is **markdown** content.',
        summary: 'A short summary',
        image: 'https://example.com/cover.jpg',
        hashtags: ['nostr', 'test'],
      );

      expect(event.kind, 30023);
      expect(event.content, contains('# Hello'));

      // d tag (stable identifier — required for editability).
      final dTags = event.tags.where((t) => t[0] == 'd').toList();
      expect(dTags, hasLength(1));
      expect(dTags.first[1], isNotEmpty);

      // Recommended metadata.
      expect(event.getTag('title'), 'My Test Article');
      expect(event.getTag('summary'), 'A short summary');
      expect(event.getTag('image'), 'https://example.com/cover.jpg');
      expect(event.getTag('published_at'), isNotNull);

      // Topic tags (t).
      final tTags = event.getTags('t');
      expect(tTags, containsAll(['nostr', 'test']));

      // Coordinate (kind:pubkey:d) used for NIP-22 comments + naddr.
      final d = event.getTag('d')!;
      expect(event.address, '${event.kind}:${event.pubkey}:$d');
    });

    test('omits optional tags when not provided', () {
      final c = makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final event = nostr.createArticle(
        title: 'Minimal',
        content: 'Just text.',
      );

      expect(event.getTag('summary'), isNull);
      expect(event.getTag('image'), isNull);
      expect(event.getTag('title'), 'Minimal');
      // d + published_at still present (editability + publish time).
      expect(event.getTag('d'), isNotNull);
      expect(event.getTag('published_at'), isNotNull);
    });

    test('hashtags are lowercased (NIP-12 convention)', () {
      final c = makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final event = nostr.createArticle(
        title: 'T',
        content: 'c',
        hashtags: ['Nostr', 'BITCOIN'],
      );
      expect(event.getTags('t'), containsAll(['nostr', 'bitcoin']));
    });

    test('d tag is stable when provided (edit = same identity)', () {
      final c = makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final v1 = nostr.createArticle(
        title: 'V1',
        content: 'first',
        dTag: 'my-article',
      );
      final v2 = nostr.createArticle(
        title: 'V2',
        content: 'edited',
        dTag: 'my-article',
      );
      // Same coordinate → the second replaces the first (addressable).
      expect(v1.address, v2.address);
      expect(v2.getTag('title'), 'V2');
    });
  });
}
