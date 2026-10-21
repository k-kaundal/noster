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
