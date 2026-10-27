import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/utils/language_detect.dart';

void main() {
  group('detectScript', () {
    test('English prose is latin', () {
      expect(
        detectScript('Hello world, this is a post about bitcoin and nostr'),
        ScriptFamily.latin,
      );
    });

    test('Hindi is devanagari', () {
      expect(
        detectScript('नमस्ते दुनिया, यह एक पोस्ट है'),
        ScriptFamily.devanagari,
      );
    });

    test('Arabic is arabic', () {
      expect(detectScript('مرحبا بالعالم هذه تدوينة'), ScriptFamily.arabic);
    });

    test('Russian is cyrillic', () {
      expect(detectScript('Привет мир это пост'), ScriptFamily.cyrillic);
    });

    test('Japanese kana is kana', () {
      expect(detectScript('こんにちは世界これは投稿です'), ScriptFamily.kana);
    });

    test('Chinese is cjk', () {
      expect(detectScript('你好世界这是一个帖子'), ScriptFamily.cjk);
    });

    test('Korean is hangul', () {
      expect(detectScript('안녕하세요 세계 이것은 게시물입니다'), ScriptFamily.hangul);
    });

    test('Thai is thai', () {
      expect(detectScript('สวัสดีชาวโลกนี่คือโพสต์'), ScriptFamily.thai);
    });

    test('Tamil is tamil', () {
      expect(detectScript('வணக்கம் உலகம் இது ஒரு இடுகை'), ScriptFamily.tamil);
    });

    test('Emoji-only is other', () {
      expect(detectScript('🔥🚀⚡'), ScriptFamily.other);
    });

    test('Empty string is other', () {
      expect(detectScript(''), ScriptFamily.other);
    });

    test('Mixed majority-Latin with one Hindi word is latin', () {
      expect(
        detectScript(
          'This is mostly English with one नमस्ते word in it, definitely latin',
        ),
        ScriptFamily.latin,
      );
    });

    test('URLs and punctuation are skipped', () {
      expect(
        detectScript('Check this out! https://example.com/article?id=123 🚀'),
        ScriptFamily.latin,
      );
    });
  });

  group('scriptForLanguage', () {
    test('hi/mr/ne map to devanagari', () {
      expect(scriptForLanguage('hi'), ScriptFamily.devanagari);
      expect(scriptForLanguage('mr'), ScriptFamily.devanagari);
      expect(scriptForLanguage('ne'), ScriptFamily.devanagari);
    });

    test('en/es/fr/de/pt/tr map to latin', () {
      for (final l in ['en', 'es', 'fr', 'de', 'pt', 'tr', 'id', 'vi']) {
        expect(scriptForLanguage(l), ScriptFamily.latin, reason: l);
      }
    });

    test('ar/fa/ur map to arabic', () {
      expect(scriptForLanguage('ar'), ScriptFamily.arabic);
      expect(scriptForLanguage('fa'), ScriptFamily.arabic);
      expect(scriptForLanguage('ur'), ScriptFamily.arabic);
    });

    test('ja maps to kana, zh to cjk, ko to hangul', () {
      expect(scriptForLanguage('ja'), ScriptFamily.kana);
      expect(scriptForLanguage('zh'), ScriptFamily.cjk);
      expect(scriptForLanguage('ko'), ScriptFamily.hangul);
    });

    test('ru/uk/bg map to cyrillic', () {
      expect(scriptForLanguage('ru'), ScriptFamily.cyrillic);
      expect(scriptForLanguage('uk'), ScriptFamily.cyrillic);
    });
  });

  group('scriptMatchesUser', () {
    test('Hindi post matches a hi user', () {
      expect(scriptMatchesUser(ScriptFamily.devanagari, ['hi', 'en']), isTrue);
    });

    test('Latin post matches any latin-language user', () {
      expect(scriptMatchesUser(ScriptFamily.latin, ['en']), isTrue);
      expect(scriptMatchesUser(ScriptFamily.latin, ['tr']), isTrue);
      expect(scriptMatchesUser(ScriptFamily.latin, ['hi', 'en']), isTrue);
    });

    test('Thai post does NOT match a Latin-only user', () {
      expect(scriptMatchesUser(ScriptFamily.thai, ['en']), isFalse);
    });

    test('Thai post does NOT match a pure Hindi user', () {
      expect(scriptMatchesUser(ScriptFamily.thai, ['hi']), isFalse);
    });

    test('other always matches (emoji/neutral posts)', () {
      expect(scriptMatchesUser(ScriptFamily.other, ['en']), isTrue);
      expect(scriptMatchesUser(ScriptFamily.other, []), isTrue);
    });

    test('empty user languages never penalize', () {
      expect(scriptMatchesUser(ScriptFamily.thai, []), isTrue);
    });
  });
}
