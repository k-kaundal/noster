import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/utils/language_detect.dart';
import 'package:nostrfeed_mobile/features/feed/application/personalization_service.dart';

NostrEvent _post({
  required String pubkey,
  required String content,
  List<List<String>> tags = const [],
}) {
  return NostrEvent(
    id: 'id$pubkey$content',
    pubkey: pubkey,
    createdAt: 1000,
    kind: 1,
    tags: tags,
    content: content,
    sig: 'sig',
  );
}

void main() {
  const alice = 'aa11';
  const bob = 'bb22';
  const carol = 'cc33';

  PersonalizationProfile profile({
    String? country,
    List<String> languages = const ['en'],
    List<String> interestTags = const [],
    List<String> engagedAuthors = const [],
    List<String> follows = const [],
  }) => PersonalizationProfile(
    country: country,
    languages: languages,
    interestTags: interestTags,
    engagedAuthors: engagedAuthors,
    follows: follows,
  );

  group('personalizationBoost', () {
    test(
      'neutral post with empty profile scores 1.0-ish (latin match only)',
      () {
        final boost = personalizationBoost(
          event: _post(pubkey: alice, content: 'hello world'),
          profile: profile(languages: []),
        );
        expect(boost, 1.0);
      },
    );

    test('followed author boosts 2.6×', () {
      final boost = personalizationBoost(
        event: _post(pubkey: alice, content: 'hello world'),
        profile: profile(languages: [], follows: [alice]),
      );
      expect(boost, closeTo(2.6, 0.001));
    });

    test('engaged author boosts 1.8×', () {
      final boost = personalizationBoost(
        event: _post(pubkey: bob, content: 'hello world'),
        profile: profile(languages: [], engagedAuthors: [bob]),
      );
      expect(boost, closeTo(1.8, 0.001));
    });

    test('interest hashtag boosts 1.7×', () {
      final boost = personalizationBoost(
        event: _post(
          pubkey: carol,
          content: 'gm',
          tags: const [
            ['t', 'bitcoin'],
          ],
        ),
        profile: profile(languages: [], interestTags: ['bitcoin']),
      );
      expect(boost, closeTo(1.7, 0.001));
    });

    test('country hashtag boosts 1.35× (ISO code)', () {
      final boost = personalizationBoost(
        event: _post(
          pubkey: carol,
          content: 'news',
          tags: const [
            ['t', 'in'],
          ],
        ),
        profile: profile(country: 'IN', languages: []),
      );
      expect(boost, closeTo(1.35, 0.001));
    });

    test('country hashtag boosts 1.35× (country name tag)', () {
      final boost = personalizationBoost(
        event: _post(
          pubkey: carol,
          content: 'news from home',
          tags: const [
            ['t', 'india'],
          ],
        ),
        profile: profile(country: 'IN', languages: []),
      );
      expect(boost, closeTo(1.35, 0.001));
    });

    test('language script match boosts 1.5×', () {
      final boost = personalizationBoost(
        event: _post(pubkey: alice, content: 'नमस्ते दुनिया यह एक पोस्ट है'),
        profile: profile(languages: ['hi']),
      );
      expect(boost, closeTo(1.5, 0.001));
    });

    test('unreadable non-latin script ranks DOWN (0.45×), never hidden', () {
      final boost = personalizationBoost(
        event: _post(pubkey: alice, content: 'สวัสดีชาวโลกนี่คือโพสต์ภาษาไทย'),
        profile: profile(languages: ['en']),
      );
      expect(boost, closeTo(0.45, 0.001));
    });

    test('emoji-only post is neutral (no penalty)', () {
      final boost = personalizationBoost(
        event: _post(pubkey: alice, content: '🔥🚀⚡'),
        profile: profile(languages: ['en']),
      );
      expect(boost, 1.0);
    });

    test('boosts stack multiplicatively (followed + interest)', () {
      final boost = personalizationBoost(
        event: _post(
          pubkey: alice,
          content: 'gm',
          tags: const [
            ['t', 'nostr'],
          ],
        ),
        profile: profile(
          languages: [],
          follows: [alice],
          interestTags: ['nostr'],
        ),
      );
      expect(boost, closeTo(2.6 * 1.7, 0.001));
    });

    test('explicit script param is honored (caller-cached)', () {
      final boost = personalizationBoost(
        event: _post(pubkey: alice, content: 'ignored'),
        profile: profile(languages: ['hi']),
        script: ScriptFamily.devanagari,
      );
      expect(boost, closeTo(1.5, 0.001));
    });
  });
}
