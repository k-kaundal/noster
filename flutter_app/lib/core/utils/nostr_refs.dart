import 'package:nostrfeed_mobile/core/utils/nip19.dart';

/// Classification of a Nostr reference found in post content (NIP-21/27).
enum NostrRefKind { mention, note, event, address, key, unknown }

/// A parsed Nostr reference (nostr:npub…, nostr:note1…, nostr:naddr1…,
/// or a bare npub/nsec key).
class NostrRef {
  final String raw; // full matched string (incl. 'nostr:' prefix if present)
  final String id; // the bech32 part
  final NostrRefKind kind;
  final Nip19Id? decoded;

  const NostrRef({
    required this.raw,
    required this.id,
    required this.kind,
    this.decoded,
  });

  /// Display label for inline rendering.
  String get label {
    switch (kind) {
      case NostrRefKind.mention:
        return '@${_short(id)}';
      case NostrRefKind.note:
      case NostrRefKind.event:
        return '🔗 ${_short(id)}';
      case NostrRefKind.address:
        return '📄 ${_short(id)}';
      case NostrRefKind.key:
        return '🔑 ${_short(id)}';
      case NostrRefKind.unknown:
        return _short(id);
    }
  }

  /// Route to navigate to on tap, or null to open externally.
  String? get route {
    switch (decoded) {
      case Nip19Pubkey(pubkey: final pk):
        return '/profile/$pk';
      case Nip19Profile(pubkey: final pk):
        return '/profile/$pk';
      case Nip19Note():
      case Nip19Event():
      case Nip19Address():
        return '/$id';
      default:
        return null;
    }
  }

  static String _short(String id) =>
      id.length > 14 ? '${id.substring(0, 12)}…' : id;
}

/// Parses Nostr references from text (NIP-21 nostr: URIs + bare bech32 keys).
class NostrRefParser {
  NostrRefParser._();

  /// nostr: URI scheme (NIP-21): npub, nprofile, note, nevent, naddr.
  static final _nostrUriRegex = RegExp(
    r'nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+|note1[a-z0-9]+|nevent1[a-z0-9]+|naddr1[a-z0-9]+)',
    caseSensitive: false,
  );

  /// Bare bech32 keys mentioned without the nostr: prefix.
  static final _bareKeyRegex = RegExp(
    r'\b(npub1[a-z0-9]{20,}|nsec1[a-z0-9]{20,}|nprofile1[a-z0-9]{20,})\b',
    caseSensitive: false,
  );

  /// Find all nostr: URI references in text.
  static List<NostrRef> findUriRefs(String text) {
    return _nostrUriRegex.allMatches(text).map((m) {
      final id = m.group(1)!;
      return NostrRef(
        raw: m.group(0)!,
        id: id,
        kind: _kindFor(id),
        decoded: decodeNip19(id),
      );
    }).toList();
  }

  /// Find all bare bech32 keys (npub/nsec/nprofile) in text.
  static List<NostrRef> findBareKeys(String text) {
    return _bareKeyRegex.allMatches(text).map((m) {
      final id = m.group(1)!;
      return NostrRef(
        raw: m.group(0)!,
        id: id,
        kind: id.startsWith('nsec1') ? NostrRefKind.key : NostrRefKind.mention,
        decoded: decodeNip19(id),
      );
    }).toList();
  }

  /// All references (nostr: URIs + bare keys), deduped by raw string.
  static List<NostrRef> findAll(String text) {
    final refs = <NostrRef>[];
    final seen = <String>{};
    for (final r in [...findUriRefs(text), ...findBareKeys(text)]) {
      if (seen.add(r.raw)) refs.add(r);
    }
    return refs;
  }

  static NostrRefKind _kindFor(String id) {
    if (id.startsWith('npub1') || id.startsWith('nprofile1')) {
      return NostrRefKind.mention;
    }
    if (id.startsWith('note1')) return NostrRefKind.note;
    if (id.startsWith('nevent1')) return NostrRefKind.event;
    if (id.startsWith('naddr1')) return NostrRefKind.address;
    return NostrRefKind.unknown;
  }
}
