import 'dart:convert';
import 'dart:math';
import 'package:bip340/bip340.dart' as bip340;
import 'package:crypto/crypto.dart';
import 'package:hex/hex.dart';

import 'package:nostrfeed_mobile/core/nostr/kinds.dart';

export 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

/// Nostr event per NIP-01.
class NostrEvent {
  final String id;
  final String pubkey;
  final int createdAt;
  final int kind;
  final List<List<String>> tags;
  final String content;
  final String sig;

  const NostrEvent({
    required this.id,
    required this.pubkey,
    required this.createdAt,
    required this.kind,
    required this.tags,
    required this.content,
    required this.sig,
  });

  factory NostrEvent.fromJson(Map<String, dynamic> json) => NostrEvent(
        id: _sanitize(json['id'] as String),
        pubkey: _sanitize(json['pubkey'] as String),
        createdAt: json['created_at'] as int,
        kind: json['kind'] as int,
        tags: (json['tags'] as List)
            .map((t) =>
                List<String>.from((t as List).map((x) => _sanitize('$x'))))
            .toList(),
        content: _sanitize(json['content'] as String),
        sig: _sanitize(json['sig'] as String),
      );

  /// Relay data can carry malformed UTF-16 (lone surrogates) that crashes
  /// Flutter's text engine. Strip it at the SOURCE so no screen ever sees it.
  static String _sanitize(String input) {
    final codes = input.codeUnits;
    final out = StringBuffer();
    var i = 0;
    while (i < codes.length) {
      final u = codes[i];
      if (u >= 0xD800 && u <= 0xDBFF) {
        if (i + 1 < codes.length && codes[i + 1] >= 0xDC00 && codes[i + 1] <= 0xDFFF) {
          out.writeCharCode(u);
          out.writeCharCode(codes[i + 1]);
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      if (u >= 0xDC00 && u <= 0xDFFF) {
        i++;
        continue;
      }
      out.writeCharCode(u);
      i++;
    }
    return out.toString();
  }

  /// Nullable variant of [_sanitize] for profile fields.
  static String? _sanitizeNullable(String? input) =>
      input == null ? null : _sanitize(input);

  Map<String, dynamic> toJson() => {
        'id': id,
        'pubkey': pubkey,
        'created_at': createdAt,
        'kind': kind,
        'tags': tags,
        'content': content,
        'sig': sig,
      };

  /// Serialize for ID computation per NIP-01.
  static String computeId(
    String pubkey,
    int createdAt,
    int kind,
    List<List<String>> tags,
    String content,
  ) {
    final data = jsonEncode([0, pubkey, createdAt, kind, tags, content]);
    return sha256.convert(utf8.encode(data)).toString();
  }

  /// Whether this event is cryptographically genuine: its id matches the
  /// serialized content AND the Schnorr (BIP-340) signature verifies against
  /// the pubkey. Relays are UNTRUSTED transport — never render an event
  /// that fails this. Returns false (never throws) on any malformed input.
  bool get isValid {
    try {
      // 1. The id must commit to the exact content (a relay can't tweak a
      //    field without changing the id).
      final expected = computeId(pubkey, createdAt, kind, tags, content);
      if (expected != id.toLowerCase()) return false;
      // 2. The signature must verify against the pubkey over that id.
      return bip340.verify(pubkey, id, sig);
    } catch (_) {
      return false;
    }
  }

  /// First tag value by name — sanitized for safe rendering.
  ///
  /// Tag values arrive from arbitrary relays and can carry lone UTF-16
  /// surrogates; a Text widget fed one crashes the paint pipeline. The
  /// sanitization here is the one that used to be missing on half the
  /// screens (articles, calendar, bounties read titles raw).
  String? getTag(String name) {
    for (final t in tags) {
      if (t.isNotEmpty && t[0] == name && t.length > 1) {
        return _sanitize(t[1]);
      }
    }
    return null;
  }

  /// All tag values by name (each sanitized for safe rendering).
  List<String> getTags(String name) => tags
      .where((t) => t.isNotEmpty && t[0] == name && t.length > 1)
      .map((t) => _sanitize(t[1]))
      .toList();

  /// The raw, unsanitized value — for logic that compares or parses rather
  /// than renders (bolt11 invoices, JSON descriptions, addresses). Only
  /// reach for this when the value is never going into a Text widget.
  String? getTagRaw(String name) {
    for (final t in tags) {
      if (t.isNotEmpty && t[0] == name && t.length > 1) {
        return t[1];
      }
    }
    return null;
  }

  /// All 'e' tag event IDs.
  List<String> get eventRefs => getTags('e');

  /// All 'p' tag pubkeys.
  List<String> get pubkeyRefs => getTags('p');

  /// All 't' hashtags.
  List<String> get hashtags => getTags('t');

  /// All 'q' tag quote references (NIP-18 quote reposts). A `q` tag means
  /// "this post quotes another event" — it is NOT a thread reference, so it
  /// must never make a post count as a reply.
  List<String> get quoteRefs => getTags('q');

  /// The 'e' tags that actually participate in a THREAD (root/reply),
  /// excluding quotes and plain mentions.
  ///
  /// NIP-10: marked tags carry a 4th element of `root`/`reply`/`mention`;
  /// positional (deprecated) tags have NO marker — first is root, last is
  /// reply, middle are mentions. A `mention`-marked tag and a `q` tag are
  /// citations, not thread refs. Only kind-1 posts thread (NIP-22 handles
  /// comments on other kinds via `A`/`a` scope tags, not these).
  List<List<String>> get _threadETags {
    final eTags = tags.where((t) => t.isNotEmpty && t[0] == 'e' && t.length > 1).toList();
    return eTags.where((t) {
      // A marked "mention" is a citation, not a thread ref.
      if (t.length >= 4 && t[3] == 'mention') return false;
      return true;
    }).toList();
  }

  /// Is this a reply to another event (vs a standalone post or a quote)?
  ///
  /// The old rule (`kind == 1 && eventRefs.isNotEmpty`) counted ANY e-tag —
  /// so a post that merely QUOTES another (e-tag mention, or only q tags)
  /// was wrongly labeled a reply and hidden from the Posts tab.
  bool get isReply {
    if (kind != 1) return false;
    return replyToId != null || rootId != null;
  }

  /// The quoted EVENT id this post cites via a `q` tag, if it's a plain
  /// event id (64 hex). A `q` tag can also be an address (`kind:pubkey:d`)
  /// — that's not an event id, so this returns null for those.
  String? get quoteId {
    if (quoteRefs.isEmpty) return null;
    final q = quoteRefs.first;
    return RegExp(r'^[0-9a-f]{64}$', caseSensitive: false).hasMatch(q)
        ? q.toLowerCase()
        : null;
  }

  /// Root event id if this is a reply.
  String? get rootId {
    final eTags = _threadETags;
    if (eTags.isEmpty) return null;
    // Marked "root" wins (NIP-10 preferred scheme).
    for (final t in eTags) {
      if (t.length >= 4 && t[3] == 'root') return t[1];
    }
    // A single marked "reply" with no root: the reply IS the root (direct
    // reply to the root event).
    final replyMarked = eTags.where((t) => t.length >= 4 && t[3] == 'reply').toList();
    if (replyMarked.length == 1 && eTags.length == 1) return replyMarked.first[1];
    // Positional fallback (deprecated): first unmarked e-tag is the root.
    final unmarked = eTags.where((t) => t.length < 4 || (t[3] != 'reply' && t[3] != 'root')).toList();
    if (unmarked.isNotEmpty) return unmarked.first[1];
    return null;
  }

  /// Reply-to event id (the direct parent being responded to).
  String? get replyToId {
    final eTags = _threadETags;
    if (eTags.isEmpty) return null;
    // Marked "reply" wins (NIP-10 preferred scheme).
    for (final t in eTags) {
      if (t.length >= 4 && t[3] == 'reply') return t[1];
    }
    // Positional fallback (deprecated): last unmarked e-tag is the parent;
    // with a single unmarked tag, that tag is the parent (= the root).
    final unmarked = eTags.where((t) => t.length < 4 || (t[3] != 'reply' && t[3] != 'root')).toList();
    if (unmarked.isNotEmpty) return unmarked.last[1];
    return null;
  }

  /// NIP-40 expiration timestamp.
  int? get expiration {
    final val = getTag('expiration');
    return val != null ? int.tryParse(val) : null;
  }

  /// Is this event expired?
  bool get isExpired {
    final exp = expiration;
    if (exp == null) return false;
    return exp < DateTime.now().millisecondsSinceEpoch ~/ 1000;
  }

  /// d-tag for addressable events.
  String? get dTag => getTag('d');

  /// Is this an addressable event (kind 30000-39999)?
  bool get isAddressable => NostrKinds.isAddressable(kind);

  /// Address for addressable events: kind:pubkey:dTag
  String get address => '$kind:$pubkey:${dTag ?? ''}';

  @override
  String toString() =>
      'NostrEvent(id: ${id.substring(0, 8)}…, kind: $kind, pubkey: ${pubkey.substring(0, 8)}…)';
}

/// NIP-01 filter.
class NostrFilter {
  List<String>? ids;
  List<String>? authors;
  List<int>? kinds;
  Map<String, List<String>>? tagFilters;
  int? since;
  int? until;
  int? limit;
  String? search;

  /// Client-side only (never serialized to relays): when true, the local
  /// store must NOT serve this filter (the merged query goes remote-only).
  /// Used for scopes the local index can't answer — e.g. uppercase NIP-22
  /// `A`/`E` tags (the store indexes only single-letter first-values per
  /// NIP-01, and an uppercase letter on the wire is a distinct scope that
  /// some relays treat case-insensitively — serving it locally would risk
  /// WRONG results, not just empty ones). Default false.
  bool remoteOnly = false;

  NostrFilter({
    this.ids,
    this.authors,
    this.kinds,
    this.tagFilters,
    this.since,
    this.until,
    this.limit,
    this.search,
    List<String>? eTags,
    List<String>? pTags,
    List<String>? aTags,
    List<String>? tTags,
  }) {
    // Convenience: route single-letter tags into tagFilters
    final extras = <String, List<String>>{
      if (eTags != null && eTags.isNotEmpty) 'e': eTags,
      if (pTags != null && pTags.isNotEmpty) 'p': pTags,
      if (aTags != null && aTags.isNotEmpty) 'a': aTags,
      if (tTags != null && tTags.isNotEmpty) 't': tTags,
    };
    if (extras.isNotEmpty) {
      tagFilters = {...?tagFilters, ...extras};
    }
  }

  Map<String, dynamic> toJson() {
    final m = <String, dynamic>{};
    if (ids != null) m['ids'] = ids;
    if (authors != null) m['authors'] = authors;
    if (kinds != null) m['kinds'] = kinds;
    if (tagFilters != null) {
      for (final e in tagFilters!.entries) {
        m['#${e.key}'] = e.value;
      }
    }
    if (since != null) m['since'] = since;
    if (until != null) m['until'] = until;
    if (limit != null) m['limit'] = limit;
    if (search != null) m['search'] = search;
    return m;
  }
}

/// Kind 0 profile metadata.
class NostrProfile {
  final String? name;
  final String? displayName;
  final String? about;
  final String? picture;
  final String? banner;
  final String? website;
  final String? nip05;
  final String? lud16;
  final String? lud06;
  final bool? bot;

  const NostrProfile({
    this.name,
    this.displayName,
    this.about,
    this.picture,
    this.banner,
    this.website,
    this.nip05,
    this.lud16,
    this.lud06,
    this.bot,
  });

  factory NostrProfile.fromJson(Map<String, dynamic> j) => NostrProfile(
        name: NostrEvent._sanitizeNullable(j['name'] as String?),
        displayName: NostrEvent._sanitizeNullable(j['display_name'] as String?),
        about: NostrEvent._sanitizeNullable(j['about'] as String?),
        // These reach Text widgets (the profile handle renders `nip05`) and
        // image HTTP headers (picture/banner URLs) — a lone surrogate crashes
        // both the text engine and the header codec, so sanitize them too.
        picture: NostrEvent._sanitizeNullable(j['picture'] as String?),
        banner: NostrEvent._sanitizeNullable(j['banner'] as String?),
        website: NostrEvent._sanitizeNullable(j['website'] as String?),
        nip05: NostrEvent._sanitizeNullable(j['nip05'] as String?),
        lud16: NostrEvent._sanitizeNullable(j['lud16'] as String?),
        lud06: NostrEvent._sanitizeNullable(j['lud06'] as String?),
        bot: j['bot'] as bool?,
      );

  Map<String, dynamic> toJson() => {
        if (name != null) 'name': name,
        if (displayName != null) 'display_name': displayName,
        if (about != null) 'about': about,
        if (picture != null) 'picture': picture,
        if (banner != null) 'banner': banner,
        if (website != null) 'website': website,
        if (nip05 != null) 'nip05': nip05,
        if (lud16 != null) 'lud16': lud16,
        if (lud06 != null) 'lud06': lud06,
        if (bot != null) 'bot': bot,
      };

  String get displayNameOrName {
    final raw = displayName ?? name ?? 'Anonymous';
    // Sanitize at render too — profile data can arrive via caches/paths that
    // bypass fromJson, and a lone surrogate here crashes the text engine.
    return NostrEvent._sanitize(raw);
  }

  NostrProfile copyWith({
    String? name,
    String? displayName,
    String? about,
    String? picture,
    String? banner,
    String? website,
    String? nip05,
    String? lud16,
    String? lud06,
    bool? bot,
  }) =>
      NostrProfile(
        name: name ?? this.name,
        displayName: displayName ?? this.displayName,
        about: about ?? this.about,
        picture: picture ?? this.picture,
        banner: banner ?? this.banner,
        website: website ?? this.website,
        nip05: nip05 ?? this.nip05,
        lud16: lud16 ?? this.lud16,
        lud06: lud06 ?? this.lud06,
        bot: bot ?? this.bot,
      );
}

/// Relay entry with read/write intent (NIP-65).
class RelayEntry {
  final String url;
  final bool read;
  final bool write;

  const RelayEntry({required this.url, this.read = true, this.write = true});

  factory RelayEntry.fromJson(Map<String, dynamic> j) => RelayEntry(
        url: j['url'] as String,
        read: j['read'] as bool? ?? true,
        write: j['write'] as bool? ?? true,
      );

  Map<String, dynamic> toJson() => {'url': url, 'read': read, 'write': write};
}

/// Zap receipt summary.
class ZapSummary {
  final int totalSats;
  final int count;
  final List<NostrEvent> receipts;

  const ZapSummary({
    required this.totalSats,
    required this.count,
    required this.receipts,
  });
}

/// Generate random hex string.
String randomHex(int bytes) {
  final rng = Random.secure();
  final data = List<int>.generate(bytes, (_) => rng.nextInt(256));
  return HEX.encode(data);
}

/// Normalize a relay URL to canonical form.
/// SECURITY: Always upgrades to wss:// (encrypted WebSocket).
/// ws:// (unencrypted) is only allowed for localhost development.
String normalizeRelayUrl(String url) {
  var u = url.trim().toLowerCase();
  if (!u.startsWith('wss://') && !u.startsWith('ws://')) u = 'wss://$u';
  if (u.endsWith('/')) u = u.substring(0, u.length - 1);
  return u;
}

/// Validate relay URL format.
/// SECURITY: Only wss:// is allowed for public relays.
/// ws:// is only permitted for localhost/127.0.0.1 (development).
bool isValidRelayUrl(String url) {
  try {
    final uri = Uri.parse(url);
    if (uri.scheme == 'wss' && uri.host.isNotEmpty) return true;
    // Allow ws:// only for localhost development
    if (uri.scheme == 'ws' &&
        (uri.host == 'localhost' || uri.host == '127.0.0.1')) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}
