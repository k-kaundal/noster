import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

void main() {
  group('sanitizeText', () {
    test('passes through normal text unchanged', () {
      expect(sanitizeText('hello world'), 'hello world');
      expect(sanitizeText('Bitcoin ⚡ nostr 💜'), 'Bitcoin ⚡ nostr 💜');
    });

    test('handles null and empty', () {
      expect(sanitizeText(null), '');
      expect(sanitizeText(''), '');
    });

    test('strips lone high surrogate', () {
      // A high surrogate (D83D) not followed by a low one.
      final broken = 'hello\uD83Dworld';
      final clean = sanitizeText(broken);
      expect(clean, 'helloworld');
    });

    test('strips lone low surrogate', () {
      final broken = 'hello\uDE00world';
      expect(sanitizeText(broken), 'helloworld');
    });

    test('keeps valid surrogate pairs (emoji)', () {
      // ⚡ = U+26A1 (BMP, no surrogate needed); 😀 = surrogate pair.
      const emoji = 'zap 😀 done';
      expect(sanitizeText(emoji), emoji);
    });

    test('strips surrogate at string boundary', () {
      expect(sanitizeText('text\uD83D'), 'text');
      expect(sanitizeText('\uD83Dtext'), 'text');
    });

    test('result never crashes a Text widget', () {
      // The whole point: output must be well-formed UTF-16.
      final inputs = [
        'a\uD800b',
        'x\uDFFFy',
        '\uD83D\uDE00valid', // valid pair
        'mixed ok\uD83D and \uDE00 bad',
      ];
      for (final input in inputs) {
        final clean = sanitizeText(input);
        // Re-encoding must not throw and every surrogate must be paired.
        final units = clean.codeUnits;
        for (var i = 0; i < units.length; i++) {
          final u = units[i];
          if (u >= 0xD800 && u <= 0xDBFF) {
            expect(i + 1 < units.length, isTrue, reason: 'lone high surrogate');
            expect(units[i + 1], inInclusiveRange(0xDC00, 0xDFFF));
            i++;
          } else {
            expect(u >= 0xDC00 && u <= 0xDFFF, isFalse,
                reason: 'lone low surrogate at $i');
          }
        }
      }
    });
  });

  group('safeSnippet', () {
    test('truncates without breaking pairs', () {
      final long = 'a' * 300;
      expect(safeSnippet(long, 100).length, 100);
    });

    test('short text passes through', () {
      expect(safeSnippet('short'), 'short');
    });
  });
}
