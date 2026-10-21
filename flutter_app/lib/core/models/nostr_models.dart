import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:hex/hex.dart';

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
        id: json['id'] as String,
        pubkey: json['pubkey'] as String,
        createdAt: json['created_at'] as int,
        kind: json['kind'] as int,
        tags: (json['tags'] as List)
            .map((t) => List<String>.from(t as List))
            .toList(),
        content: json['content'] as String,
        sig: json['sig'] as String,
      );

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

  /// First tag value by name.
  String? getTag(String name) {
    for (final t in tags) {
      if (t.isNotEmpty && t[0] == name && t.length > 1) return t[1];
    }
    return null;
  }

  /// All tag values by name.
  List<String> getTags(String name) => tags
      .where((t) => t.isNotEmpty && t[0] == name && t.length > 1)
      .map((t) => t[1])
      .toList();

  /// All 'e' tag event IDs.
  List<String> get eventRefs => getTags('e');

  /// All 'p' tag pubkeys.
  List<String> get pubkeyRefs => getTags('p');

  /// All 't' hashtags.
  List<String> get hashtags => getTags('t');

  /// Is this a reply?
  bool get isReply => kind == 1 && eventRefs.isNotEmpty;

  /// Root event id if this is a reply.
  String? get rootId {
    final eTags = tags.where((t) => t.isNotEmpty && t[0] == 'e').toList();
    if (eTags.isEmpty) return null;
    // Check for 'root' marker
    for (final t in eTags) {
      if (t.length >= 4 && t[3] == 'root') return t[1];
    }
    return eTags.first[1]; // Fallback: first e-tag
  }

  /// Reply-to event id (parent).
  String? get replyToId {
    final eTags = tags.where((t) => t.isNotEmpty && t[0] == 'e').toList();
    if (eTags.isEmpty) return null;
    for (final t in eTags) {
      if (t.length >= 4 && t[3] == 'reply') return t[1];
    }
    return eTags.length > 1 ? eTags.last[1] : eTags.first[1];
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
  bool get isAddressable => kind >= 30000 && kind < 40000;

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
        name: j['name'] as String?,
        displayName: j['display_name'] as String?,
        about: j['about'] as String?,
        picture: j['picture'] as String?,
        banner: j['banner'] as String?,
        website: j['website'] as String?,
        nip05: j['nip05'] as String?,
        lud16: j['lud16'] as String?,
        lud06: j['lud06'] as String?,
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

  String get displayNameOrName => displayName ?? name ?? 'Anonymous';

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
