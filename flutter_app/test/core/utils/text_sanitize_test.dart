import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

void main() {
  group('firstGrapheme', () {
    test('plain ASCII name', () {
      expect(firstGrapheme('alice'), 'a');
    });

    test('name starting with an emoji returns the full surrogate pair', () {
      // 😀 = + its low surrogate. name[0] would be a lone high
      // surrogate — the avatar-initial crash.
      expect(firstGrapheme('😀alice'), '😀');
    });

    test('empty / null', () {
      expect(firstGrapheme(''), '?');
      expect(firstGrapheme(null), '?');
    });

    test('sanitizes lone surrogates in the name', () {
      // A name carrying a stray lone high surrogate mid-string.
      final broken = 'ab\uD83Dcde';
      final g = firstGrapheme(broken);
      expect(g, 'a');
      // The whole thing must be renderable (no exception when building).
      expect(() => sanitizeText(broken), returnsNormally);
    });

    test('a lone surrogate at the start is stripped, not returned', () {
      final broken = '\uD83Dalice';
      expect(firstGrapheme(broken), 'a');
    });
  });

  group('sanitizeText', () {
    test('strips lone high and low surrogates', () {
      expect(sanitizeText('a\uD83Db'), 'ab');
      expect(sanitizeText('a\uDCDEb'), 'ab');
    });

    test('keeps valid surrogate pairs (emoji)', () {
      expect(sanitizeText('gm 😀 nostr'), 'gm 😀 nostr');
    });
  });
}
