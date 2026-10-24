/// Detects + classifies content that is an ENCRYPTED or TOKEN payload rather
/// than readable post text, so the feed can render it as a proper card
/// (ecash claim card, "encrypted content" card) instead of a base64 wall or
/// a hidden gap.
///
/// Shapes handled:
/// - NIP-04 DM: `<base64>?iv=<base64>`
/// - ecash / Cashu tokens: `cashuA…` (base64 JSON — decodable to amount+mint)
///   and `cashuB…` (CBOR — shown as "ecash token" without decoding)
/// - Colon-joined base64 ciphertext (NIP-44 / payment tokens)
/// - Long unbroken base64 runs (ciphertext, not prose)
library;

import 'dart:convert';

/// The class of encrypted/token payload a blob of content represents.
enum EncryptedKind {
  /// NIP-04 encrypted direct message (`?iv=` marker).
  nip04,

  /// Cashu ecash token (`cashuA` / `cashuB`).
  ecash,

  /// Colon-joined base64 ciphertext (NIP-44 v2, payment tokens).
  colonCipher,

  /// A long unbroken base64 run (undifferentiated ciphertext).
  bareBase64,

  /// A `scheme://action/<base64>` app payload (bala:// call offers, etc.).
  schemePayload,
}

/// What we know about an ecash token after a best-effort decode.
class EcashInfo {
  /// Total token value in sats, when decodable (cashuA JSON only).
  final int? amountSats;

  /// The mint host that issued the token, when decodable.
  final String? mintHost;

  /// Whether this is the CBOR v4 format (`cashuB`) we don't decode.
  final bool isV4;

  const EcashInfo({this.amountSats, this.mintHost, this.isV4 = false});
}

/// NIP-04 encrypted DM: `<base64-ciphertext>?iv=<base64-iv>`.
final _nip04Re = RegExp(
  r'^[A-Za-z0-9+/]+={0,2}\?iv=[A-Za-z0-9+/]+={0,2}$',
);

/// Cashu token prefix: `cashuA…` (v3 base64 JSON) or `cashuB…` (v4 CBOR).
final _ecashRe = RegExp(r'^cashu([AB])([A-Za-z0-9_\-+/]+=*)$', caseSensitive: false);

/// Colon-separated base64 segments (NIP-44 v2 ciphertext, some payment
/// tokens — the `sbkimdm1:BEOdRv…:…==` report).
final _colonCipherRe = RegExp(
  r'^[A-Za-z0-9+/]{6,}={0,2}(?::[A-Za-z0-9+/=_\-]{8,}={0,2}){1,4}$',
);

/// A long unbroken base64 run — ciphertext, not a sentence.
final _bareBase64Re = RegExp(r'^[A-Za-z0-9+/]{120,}={0,2}$');

/// A `scheme://action/<base64-payload>` URI (optionally with extra path
/// segments). e.g. `bala://offer/eyJuYW1l…` — app-specific payloads shared
/// as links in posts. Captures scheme, action, and first base64 segment.
final _schemePayloadRe = RegExp(
  r'^([a-z][a-z0-9+.\-]*)://([A-Za-z0-9_\-]+)/([A-Za-z0-9+/=_\-]{20,}={0,2})',
  caseSensitive: false,
);

/// Classify [content] as an encrypted/token payload, or null if it's
/// readable post text.
///
/// Conservative: only fires on UNAMBIGUOUS ciphertext shapes. Prose with
/// spaces, URLs, and multilingual text are NEVER classified — a post that
/// merely contains a base64-ish word inside real writing stays a post.
EncryptedKind? classifyEncrypted(String content) {
  final t = content.trim();
  if (t.isEmpty) return null;
  // Internal whitespace = prose that happens to contain a token, not a
  // payload. (An ecash token can be embedded in a sentence — that's a
  // different feature; this classifier is for whole-content payloads.)
  if (t.contains(RegExp(r'\s'))) return null;

  if (_nip04Re.hasMatch(t)) return EncryptedKind.nip04;
  if (_ecashRe.hasMatch(t)) return EncryptedKind.ecash;
  if (_schemePayloadRe.hasMatch(t)) return EncryptedKind.schemePayload;
  if (_colonCipherRe.hasMatch(t)) return EncryptedKind.colonCipher;
  if (_bareBase64Re.hasMatch(t)) return EncryptedKind.bareBase64;
  return null;
}

/// A decoded `scheme://action/<base64>` payload (bala:// call offers and
/// similar app-specific links shared as posts). All fields best-effort —
/// present only when the payload actually decodes.
class SchemePayload {
  /// The URI scheme (e.g. `bala`).
  final String scheme;

  /// The action segment (e.g. `offer`).
  final String action;

  /// The decoded UTF-8 payload text (usually JSON), or null if undecodable.
  final String? decodedText;

  /// The decoded JSON object, when the payload is JSON.
  final Map<String, dynamic>? json;

  const SchemePayload({
    required this.scheme,
    required this.action,
    this.decodedText,
    this.json,
  });

  /// A short human summary of the JSON payload for the card subtitle
  /// (e.g. a call offer's room + candidate count). Falls back to the
  /// decoded text snippet.
  String get summary {
    final j = json;
    if (j != null) {
      final parts = <String>[];
      if (j['name'] is String) parts.add(j['name'] as String);
      if (j['room'] != null) parts.add('room ${j['room']}');
      if (j['candidates'] is List) {
        parts.add('${(j['candidates'] as List).length} connection candidates');
      }
      if (parts.isNotEmpty) return parts.join(' · ');
    }
    final t = decodedText;
    if (t == null) return 'Encoded payload';
    return t.length > 80 ? '${t.substring(0, 80)}…' : t;
  }
}

/// Detect + decode a `scheme://action/<base64-payload>` content string.
/// Returns null when the content isn't that shape or the payload isn't
/// valid base64.
SchemePayload? decodeSchemePayload(String content) {
  final t = content.trim();
  final m = _schemePayloadRe.firstMatch(t);
  if (m == null) return null;
  final scheme = m.group(1)!.toLowerCase();
  final action = m.group(2)!;
  final payload = m.group(3)!;

  // Only treat it as a payload when the scheme isn't a plain web link —
  // https://host/<base64ish> is a URL, not an app payload.
  if (scheme == 'http' || scheme == 'https') return null;

  String? text;
  Map<String, dynamic>? json;
  try {
    final norm = base64.normalize(
      payload.replaceAll('-', '+').replaceAll('_', '/'),
    );
    text = utf8.decode(base64.decode(norm), allowMalformed: true);
    final dec = jsonDecode(text);
    if (dec is Map<String, dynamic>) json = dec;
  } catch (_) {
    // Undecodable payload — still a scheme payload, just without JSON.
  }
  return SchemePayload(
    scheme: scheme,
    action: action,
    decodedText: text,
    json: json,
  );
}

/// Whether [content] is an encrypted/token payload (any class).
bool isEncryptedContent(String content) => classifyEncrypted(content) != null;

/// Extract the FIRST ecash token from a text, if one is present anywhere
/// (a token dropped into a note). Returns the raw token string, or null.
/// Word-boundary anchored so `cashuAxyz` inside a URL/host doesn't match.
String? extractEcashToken(String text) {
  final m = RegExp(
    r'\bcashu[AB][A-Za-z0-9_\-+/]{20,}=*\b',
    caseSensitive: false,
  ).firstMatch(text);
  return m?.group(0);
}

/// Best-effort decode of an ecash token to amount + mint.
///
/// `cashuA` tokens are `cashuA` + base64(JSON): the JSON has a `token` list
/// of `{mint, proofs:[{amount,…}]}` and a `unit`. We sum proof amounts.
/// `cashuB` is CBOR — not decoded (no CBOR dep), reported as v4.
EcashInfo decodeEcash(String token) {
  final t = token.trim();
  if (t.toLowerCase().startsWith('cashub')) {
    return const EcashInfo(isV4: true);
  }
  if (!t.toLowerCase().startsWith('cashua')) {
    return const EcashInfo();
  }
  try {
    final b64 = t.substring(6);
    // cashuA uses standard base64 (may need padding).
    final padded = b64.padRight((b64.length + 3) & ~3, '=');
    final jsonStr = utf8.decode(base64.decode(base64.normalize(padded)));
    final j = jsonDecode(jsonStr);
    if (j is! Map<String, dynamic>) return const EcashInfo();

    var total = 0;
    String? mint;
    final tokenList = j['token'];
    if (tokenList is List) {
      for (final entry in tokenList) {
        if (entry is Map<String, dynamic>) {
          mint ??= entry['mint'] as String?;
          final proofs = entry['proofs'];
          if (proofs is List) {
            for (final p in proofs) {
              if (p is Map<String, dynamic>) {
                total += (p['amount'] as num? ?? 0).toInt();
              }
            }
          }
        }
      }
    }
    // Some payloads carry an explicit unit amount instead.
    if (total == 0 && j['amount'] is num) total = (j['amount'] as num).toInt();

    String? mintHost;
    if (mint != null) {
      mintHost = Uri.tryParse(mint)?.host ?? mint;
    }
    return EcashInfo(
      amountSats: total > 0 ? total : null,
      mintHost: mintHost,
    );
  } catch (_) {
    return const EcashInfo();
  }
}
