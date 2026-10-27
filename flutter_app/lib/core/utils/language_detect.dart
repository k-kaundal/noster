/// Language detection for feed personalization — Unicode-script based.
///
/// Country/language personalization must never block on NLP services: the
/// script a post is written in is a strong, free, on-device signal. A
/// Devanagari post is Hindi-family; Arabic script is ar/fa/ur; Hangul is
/// Korean. Latin script is the ambiguous one (en/es/fr/de/pt/…) — Latin
/// posts match ANY Latin-alphabet user language (the common case), and the
/// interest/hashtag boosts do the finer ranking.
///
/// Pure + testable: no I/O, no dependencies.
library;

/// Coarse script families a feed post can be written in.
enum ScriptFamily {
  latin, // en es fr de pt it tr id nl pl vi …
  devanagari, // hi mr ne sa
  bengali, // bn as
  arabic, // ar fa ur ps
  cyrillic, // ru uk bg sr mk
  cjk, // zh ja (kanji) — Han ideographs
  kana, // ja (hiragana/katakana)
  hangul, // ko
  thai, // th
  tamil, // ta
  telugu, // te
  gujarati, // gu
  gurmukhi, // pa
  kannada, // kn
  malayalam, // ml
  hebrew, // he yi
  greek, // el
  armenian, // hy
  georgian, // ka
  other, // emoji-only, symbols, undetectable
}

/// Detect the dominant script family of [text] (first 400 chars is plenty).
///
/// Counts code points per family over a bounded sample; the family with the
/// most hits wins. Emoji/URLs/whitespace/punctuation are skipped. Mixed
/// posts (Latin + one native-script word) classify by MAJORITY — a mostly-
/// English post with one Hindi word is `latin` (correct: the reader reads
/// Latin).
ScriptFamily detectScript(String text) {
  if (text.isEmpty) return ScriptFamily.other;
  final sample = text.length > 400 ? text.substring(0, 400) : text;
  final counts = <ScriptFamily, int>{};
  for (final rune in sample.runes) {
    // Skip whitespace, punctuation, digits, emoji, URLs chars.
    if (rune < 0x40 ||
        (rune >= 0x5B && rune <= 0x60) ||
        rune == 0x7B ||
        rune == 0x7D ||
        (rune >= 0x1F000)) {
      continue;
    }
    final family = _familyFor(rune);
    if (family != null) {
      counts[family] = (counts[family] ?? 0) + 1;
    }
  }
  if (counts.isEmpty) return ScriptFamily.other;
  return counts.entries.reduce((a, b) => a.value >= b.value ? a : b).key;
}

ScriptFamily? _familyFor(int rune) {
  // Latin: ASCII letters + Latin-1/Extended-A/B + Vietnamese.
  if ((rune >= 0x41 && rune <= 0x5A) ||
      (rune >= 0x61 && rune <= 0x7A) ||
      (rune >= 0xC0 && rune <= 0x24F) ||
      (rune >= 0x1E00 && rune <= 0x1EFF)) {
    return ScriptFamily.latin;
  }
  if (rune >= 0x0900 && rune <= 0x097F) return ScriptFamily.devanagari;
  if (rune >= 0x0980 && rune <= 0x09FF) return ScriptFamily.bengali;
  if (rune >= 0x0A00 && rune <= 0x0A7F) return ScriptFamily.gurmukhi;
  if (rune >= 0x0A80 && rune <= 0x0AFF) return ScriptFamily.gujarati;
  if (rune >= 0x0B80 && rune <= 0x0BFF) return ScriptFamily.tamil;
  if (rune >= 0x0C00 && rune <= 0x0C7F) return ScriptFamily.telugu;
  if (rune >= 0x0C80 && rune <= 0x0CFF) return ScriptFamily.kannada;
  if (rune >= 0x0D00 && rune <= 0x0D7F) return ScriptFamily.malayalam;
  if (rune >= 0x0E00 && rune <= 0x0E7F) return ScriptFamily.thai;
  if ((rune >= 0x0600 && rune <= 0x06FF) ||
      (rune >= 0x0750 && rune <= 0x077F) ||
      (rune >= 0xFB50 && rune <= 0xFDFF)) {
    return ScriptFamily.arabic;
  }
  if (rune >= 0x0400 && rune <= 0x04FF) return ScriptFamily.cyrillic;
  if (rune >= 0x0590 && rune <= 0x05FF) return ScriptFamily.hebrew;
  if (rune >= 0x0370 && rune <= 0x03FF) return ScriptFamily.greek;
  if (rune >= 0x0530 && rune <= 0x058F) return ScriptFamily.armenian;
  if (rune >= 0x10A0 && rune <= 0x10FF) return ScriptFamily.georgian;
  // CJK unified ideographs + extensions.
  if ((rune >= 0x4E00 && rune <= 0x9FFF) ||
      (rune >= 0x3400 && rune <= 0x4DBF) ||
      (rune >= 0x20000 && rune <= 0x2A6DF)) {
    return ScriptFamily.cjk;
  }
  if ((rune >= 0x3040 && rune <= 0x30FF) ||
      (rune >= 0x31F0 && rune <= 0x31FF)) {
    return ScriptFamily.kana;
  }
  if ((rune >= 0xAC00 && rune <= 0xD7AF) ||
      (rune >= 0x1100 && rune <= 0x11FF)) {
    return ScriptFamily.hangul;
  }
  return null;
}

/// Map a BCP-47 language code (device locale) to the script family a reader
/// of that language expects. Latin-alphabet languages all map to `latin`.
ScriptFamily scriptForLanguage(String languageCode) {
  switch (languageCode.toLowerCase()) {
    case 'hi':
    case 'mr':
    case 'ne':
    case 'sa':
    case 'kok':
    case 'mai':
    case 'bho':
      return ScriptFamily.devanagari;
    case 'bn':
    case 'as':
      return ScriptFamily.bengali;
    case 'pa':
      return ScriptFamily.gurmukhi;
    case 'gu':
      return ScriptFamily.gujarati;
    case 'ta':
      return ScriptFamily.tamil;
    case 'te':
      return ScriptFamily.telugu;
    case 'kn':
      return ScriptFamily.kannada;
    case 'ml':
      return ScriptFamily.malayalam;
    case 'th':
      return ScriptFamily.thai;
    case 'ar':
    case 'fa':
    case 'ur':
    case 'ps':
    case 'ckb':
      return ScriptFamily.arabic;
    case 'ru':
    case 'uk':
    case 'bg':
    case 'sr':
    case 'mk':
    case 'kk':
    case 'ky':
    case 'tg':
    case 'mn':
    case 'be':
      return ScriptFamily.cyrillic;
    case 'zh':
      return ScriptFamily.cjk;
    case 'ja':
      return ScriptFamily.kana;
    case 'ko':
      return ScriptFamily.hangul;
    case 'he':
    case 'yi':
      return ScriptFamily.hebrew;
    case 'el':
      return ScriptFamily.greek;
    case 'hy':
      return ScriptFamily.armenian;
    case 'ka':
      return ScriptFamily.georgian;
    default:
      return ScriptFamily.latin;
  }
}

/// Whether a post in [postScript] is readable by a user whose device
/// languages are [userLanguages] (BCP-47 primary codes, e.g. `en`, `hi`).
///
/// Rule: exact script-family match OR the post is Latin-script and ANY user
/// language is Latin-alphabet (the lingua-franca case — an `en`/`es`/`tr`
/// user reads Latin posts). Non-matching scripts (a Thai post for a pure
/// Russian-locale user) are NOT filtered out — the caller ranks them DOWN,
/// never hides them.
bool scriptMatchesUser(ScriptFamily postScript, List<String> userLanguages) {
  if (postScript == ScriptFamily.other) return true; // neutral content
  if (userLanguages.isEmpty) return true; // unknown → don't penalize
  for (final lang in userLanguages) {
    if (scriptForLanguage(lang) == postScript) return true;
  }
  return false;
}
