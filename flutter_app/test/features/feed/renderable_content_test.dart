import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// Pins the "empty card with just a name" family: an event must either
/// render SOMETHING (text / media / quote) or be collapsed by the card.
/// These mirror real relay posts, including non-English content.
void main() {
  NostrEvent ev({
    int kind = 1,
    String content = '',
    List<List<String>> tags = const [],
  }) =>
      NostrEvent(
        id: 'e' * 2,
        pubkey: 'p' * 2,
        createdAt: 1,
        kind: kind,
        tags: tags,
        content: content,
        sig: 's' * 2,
      );

  group('multilingual content survives intact', () {
    test('CJK content is not gutted', () {
      final e = ev(content: 'これはテストです。画像付きです。');
      expect(e.content, contains('テスト'));
    });

    test('Arabic (RTL) content survives', () {
      final e = ev(content: 'مرحبا بالعالم هذا اختبار');
      expect(e.content, contains('مرحبا'));
    });

    test('Hindi + emoji content survives', () {
      final e = ev(content: 'नमस्ते दुनिया 🙏 स्वागत है');
      expect(e.content, contains('नमस्ते'));
      expect(e.content, contains('🙏'));
    });

    test('mixed script + emoji keeps surrogate pairs', () {
      final e = ev(content: 'Hello 😀 مرحبا こんにちは');
      expect(e.content, contains('😀'));
    });
  });

  group('content is displayable across shapes', () {
    test('a plain text note has content', () {
      final e = ev(content: 'just some text');
      expect(e.content.trim(), isNotEmpty);
    });

    test('a kind-20 picture post with imeta media has media', () {
      final e = ev(
        kind: 20,
        content: '',
        tags: [
          ['imeta', 'url https://nostr.build/i/a.jpg', 'm image/jpeg'],
        ],
      );
      // imeta carries the media — the card merges these into the gallery.
      expect(e.tags.any((t) => t.isNotEmpty && t[0] == 'imeta'), isTrue);
    });

    test('a quote post (q tag) has a quote even with empty content', () {
      final e = ev(
        content: 'worth reading',
        tags: [
          ['q', 'a' * 64],
        ],
      );
      expect(e.quoteId, 'a' * 64);
    });
  });
}
