/// Nostr event data comes from arbitrary relays/clients and can contain
/// malformed strings (lone UTF-16 surrogates, broken emoji pairs, invalid
/// sequences) that crash Flutter's text engine with
/// "string is not well-formed UTF-16". Sanitize before rendering.
library;

/// Returns a string safe for Flutter's text engine: strips lone surrogates
/// and invalid UTF-16 sequences.
String sanitizeText(String? input) {
  if (input == null || input.isEmpty) return '';
  final codes = input.codeUnits;
  final out = StringBuffer();
  var i = 0;
  while (i < codes.length) {
    final unit = codes[i];
    // High surrogate (D800–DBFF) — valid only when followed by low surrogate.
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      if (i + 1 < codes.length) {
        final next = codes[i + 1];
        if (next >= 0xDC00 && next <= 0xDFFF) {
          out.writeCharCode(unit);
          out.writeCharCode(next);
          i += 2;
          continue;
        }
      }
      i++; // lone high surrogate — drop
      continue;
    }
    // Low surrogate (DC00–DFFF) without preceding high surrogate — drop.
    if (unit >= 0xDC00 && unit <= 0xDFFF) {
      i++;
      continue;
    }
    out.writeCharCode(unit);
    i++;
  }
  return out.toString();
}

/// Sanitize + truncate safely (ellipsis logic can cut mid-surrogate).
String safeSnippet(String? input, [int maxLength = 200]) {
  final clean = sanitizeText(input);
  if (clean.length <= maxLength) return clean;
  return clean.substring(0, maxLength);
}

/// Nullable variant of [sanitizeText] — preserves null so "no value" stays
/// distinguishable from "empty value" (e.g. `username != null` checks).
String? sanitizeTextOrNull(String? input) =>
    input == null ? null : sanitizeText(input);

/// The first grapheme (user-perceived character) of [input], sanitized.
///
/// `name[0]` on a name that starts with an emoji is a lone high surrogate,
/// and a Text widget fed one crashes the paint pipeline ("string is not
/// well-formed UTF-16") — the avatar-initial crash this fixes. Takes the
/// first full surrogate PAIR when the name starts with one, so "😀alice"
/// shows "😀" instead of a broken box.
String firstGrapheme(String? input) {
  final clean = sanitizeText(input);
  if (clean.isEmpty) return '?';
  final codes = clean.codeUnits;
  if (codes.isEmpty) return '?';
  // Leading high surrogate + low surrogate = one grapheme (emoji).
  if (codes.length >= 2 &&
      codes[0] >= 0xD800 &&
      codes[0] <= 0xDBFF &&
      codes[1] >= 0xDC00 &&
      codes[1] <= 0xDFFF) {
    return String.fromCharCodes([codes[0], codes[1]]);
  }
  return String.fromCharCode(codes[0]);
}
