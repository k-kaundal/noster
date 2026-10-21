import 'dart:convert';
import 'dart:io';

import 'package:bech32/bech32.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_context.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_router.dart';

class SocialRepository {
  final RelayPool relayPool;
  final NostrContext ctx;
  final RelayRouter relayRouter;

  /// Freshness caches owned by `NostrService` and injected here — see
  /// `profileCache` / `followsCache` for rationale.
  final Map<String, ({NostrProfile profile, int createdAt, int fetchedAt})>
  profileCache;
  final Map<String, ({List<String> follows, int createdAt})> followsCache;

  SocialRepository(
    this.relayPool,
    this.ctx,
    this.profileCache,
    this.followsCache,
    this.relayRouter,
  );

  /// How long a cached profile is trusted before re-querying relays.
  /// Profiles rarely change; refetching every render made feeds feel slow.
  static const _profileTtlSeconds = 600; // 10 minutes

  Future<NostrProfile?> fetchProfile(String pubkey) async {
    final cached = profileCache[pubkey];

    // TTL FAST PATH: a recently-fetched profile is returned immediately with
    // NO relay round-trip (this was the main feed slowdown — every post card
    // + avatar re-queried relays on every navigation).
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    if (cached != null && now - cached.fetchedAt < _profileTtlSeconds) {
      return cached.profile;
    }

    // Query default (already-connected) relays first with a short timeout —
    // the vast majority of profiles resolve here in <1s. The outbox-model
    // lookups below only run when this misses.
    var events = await relayPool.query([
      NostrFilter(kinds: [0], authors: [pubkey], limit: 1),
    ], timeout: const Duration(seconds: 3));

    if (events.isEmpty) {
      // NIP-65 outbox model: query the user's WRITE relays (where THEY
      // publish their kind-0). Runs concurrently, capped at top 3 relays
      // and a short per-relay timeout so a dead relay can't stall the UI.
      final writeRelays = await relayRouter
          .getWriteRelays(pubkey)
          .timeout(const Duration(seconds: 3), onTimeout: () => []);
      if (writeRelays.isNotEmpty) {
        final results = await Future.wait(
          writeRelays.take(3).map(
                (url) => relayPool.queryOnRelay(
                  url,
                  [NostrFilter(kinds: [0], authors: [pubkey], limit: 1)],
                  timeout: const Duration(seconds: 2),
                ),
              ),
        );
        events = results.expand((e) => e).toList();
      }
    }

    if (events.isEmpty) {
      // Last resort: well-known indexer relays (concurrent, short timeout).
      final results = await Future.wait(
        RelayRouter.indexerRelays.take(3).map(
              (url) => relayPool.queryOnRelay(
                url,
                [NostrFilter(kinds: [0], authors: [pubkey], limit: 1)],
                timeout: const Duration(seconds: 2),
              ),
            ),
      );
      events = results.expand((e) => e).toList();
    }

    if (events.isNotEmpty) {
      try {
        // Multiple relays each return their own revision of the replaceable
        // kind-0 — taking events.first picks one at random (often STALE,
        // which is why profile fields go missing after a refresh). Sort by
        // created_at and take the NEWEST.
        events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
        final relayEvent = events.first;
        final relayProfile = NostrProfile.fromJson(
          jsonDecode(relayEvent.content) as Map<String, dynamic>,
        );
        // Only overwrite cache if relay has a NEWER kind-0 than what we
        // already have. Otherwise our local write is fresher — keep it.
        final fetchedAt = DateTime.now().millisecondsSinceEpoch ~/ 1000;
        if (cached == null || relayEvent.createdAt >= cached.createdAt) {
          profileCache[pubkey] = (
            profile: relayProfile,
            createdAt: relayEvent.createdAt,
            fetchedAt: fetchedAt,
          );
          return relayProfile;
        }
        // Refresh the TTL so we don't re-query for another 10 minutes.
        profileCache[pubkey] = (
          profile: cached.profile,
          createdAt: cached.createdAt,
          fetchedAt: fetchedAt,
        );
        return cached.profile;
      } catch (_) {
        // Fall through to cache
      }
    }

    // Relay returned nothing (or unparseable) — fall back to our last known
    // profile so the UI doesn't flash empty.
    return cached?.profile;
  }

  Future<List<String>> fetchFollows(String pubkey) async {
    final cached = followsCache[pubkey];

    // No limit:1 — kind 3 is replaceable, so each relay may return its own
    // revision. Taking the first would pick one at random (often a stale one
    // from a relay that hasn't seen the latest update yet). Pick the newest.
    final events = await relayPool.query([
      NostrFilter(kinds: [3], authors: [pubkey]),
    ], timeout: const Duration(seconds: 8));

    if (events.isNotEmpty) {
      events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      final relayEvent = events.first;
      // Only accept the relay's revision if it's at least as new as our
      // locally-known write. Otherwise our optimistic follow is fresher —
      // keep it so the UI doesn't flip back to "Follow".
      if (cached == null || relayEvent.createdAt >= cached.createdAt) {
        final follows = relayEvent.pubkeyRefs;
        followsCache[pubkey] = (
          follows: follows,
          createdAt: relayEvent.createdAt,
        );
        return follows;
      }
      return cached.follows;
    }

    // Relay returned nothing — fall back to our last known list so the UI
    // doesn't flash empty.
    return cached?.follows ?? [];
  }

  Future<List<String>> fetchFollowers(String pubkey) async {
    final events = await relayPool.query([
      NostrFilter(
        kinds: [3],
        tagFilters: {
          'p': [pubkey],
        },
        limit: 500,
      ),
    ], timeout: const Duration(seconds: 8));
    return events.map((e) => e.pubkey).toSet().toList();
  }

  /// People search. Most relays do NOT support NIP-50 `search` on kind 0
  /// (profile metadata) — so this uses multiple strategies in order:
  ///
  /// 1. Direct identifier: `npub1…` or 64-char hex pubkey → fetch by author
  /// 2. NIP-05 address (`alice@domain.com` or `domain.com`) → HTTP lookup
  /// 3. NIP-50 search against connected relays
  /// 4. Client-side fallback: fetch recent kind-0s and filter by name /
  ///    display_name / nip05 / about containing the query
  Future<List<NostrEvent>> searchUsers(String query, {int limit = 20}) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) return [];

    // ── 1. Direct identifier: npub or hex pubkey ─────────────────────
    String? directPubkey;
    if (trimmed.startsWith('npub1') && trimmed.length >= 60) {
      directPubkey = _decodeNpub(trimmed);
    } else if (trimmed.length == 64 &&
        RegExp(r'^[0-9a-fA-F]+$').hasMatch(trimmed)) {
      directPubkey = trimmed.toLowerCase();
    }
    if (directPubkey != null) {
      return relayPool.query([
        NostrFilter(kinds: [0], authors: [directPubkey], limit: 1),
      ], timeout: const Duration(seconds: 8));
    }

    // ── 2. NIP-05 address lookup ──────────────────────────────────────
    if (_looksLikeNip05(trimmed)) {
      final nip05Pubkey = await _resolveNip05(trimmed);
      if (nip05Pubkey != null) {
        final events = await relayPool.query([
          NostrFilter(kinds: [0], authors: [nip05Pubkey], limit: 1),
        ], timeout: const Duration(seconds: 8));
        if (events.isNotEmpty) return events;
      }
    }

    // ── 3. NIP-50 search on connected relays ─────────────────────────
    final indexerResults = await relayPool.query([
      NostrFilter(kinds: [0], search: trimmed, limit: limit),
    ], timeout: const Duration(seconds: 6));

    // ── 4. Client-side fallback / merge ──────────────────────────────
    // Fetch a batch of recent profiles and match locally — catches
    // partial-name matches even when NIP-50 isn't supported by the relay.
    final lowerQ = trimmed.toLowerCase();
    final recent = await relayPool.query([
      NostrFilter(kinds: [0], limit: 500),
    ], timeout: const Duration(seconds: 6));

    bool matches(NostrEvent e) {
      try {
        final json = jsonDecode(e.content) as Map<String, dynamic>;
        final name = (json['name'] as String?)?.toLowerCase() ?? '';
        final display = (json['display_name'] as String?)?.toLowerCase() ?? '';
        final displayName =
            (json['displayName'] as String?)?.toLowerCase() ?? '';
        final nip05 = (json['nip05'] as String?)?.toLowerCase() ?? '';
        final about = (json['about'] as String?)?.toLowerCase() ?? '';
        final username = (json['username'] as String?)?.toLowerCase() ?? '';
        return name.contains(lowerQ) ||
            display.contains(lowerQ) ||
            displayName.contains(lowerQ) ||
            nip05.contains(lowerQ) ||
            username.contains(lowerQ) ||
            about.contains(lowerQ);
      } catch (_) {
        return false;
      }
    }

    final localMatches = recent.where(matches).toList();

    // Merge indexer results with local matches, dedupe by pubkey, keep the
    // newest kind-0 per pubkey.
    final byPubkey = <String, NostrEvent>{};
    for (final e in [...indexerResults, ...localMatches]) {
      final existing = byPubkey[e.pubkey];
      if (existing == null || e.createdAt > existing.createdAt) {
        byPubkey[e.pubkey] = e;
      }
    }
    final merged = byPubkey.values.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

    return merged.take(limit).toList();
  }

  bool _looksLikeNip05(String q) {
    // alice@example.com  OR  example.com  OR  _@example.com
    final nip05Regex = RegExp(
      r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
    );
    if (nip05Regex.hasMatch(q)) return true;
    // Bare domain form
    return RegExp(r'^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$').hasMatch(q);
  }

  /// Resolve a NIP-05 identifier to a pubkey via HTTP.
  /// alice@example.com → https://example.com/.well-known/nostr.json?name=alice
  Future<String?> _resolveNip05(String identifier) async {
    try {
      String name;
      String domain;
      if (identifier.contains('@')) {
        final parts = identifier.split('@');
        name = parts[0];
        domain = parts[1];
      } else {
        name = '_';
        domain = identifier;
      }
      final uri = Uri.https(domain, '/.well-known/nostr.json', {'name': name});
      final client = HttpClient();
      try {
        final request = await client
            .getUrl(uri)
            .timeout(const Duration(seconds: 5));
        final response = await request.close().timeout(
          const Duration(seconds: 5),
        );
        if (response.statusCode != 200) return null;
        final body = await utf8.decoder.bind(response).join();
        final json = jsonDecode(body) as Map<String, dynamic>;
        final names = json['names'] as Map<String, dynamic>?;
        return names?[name] as String?;
      } finally {
        client.close();
      }
    } catch (_) {
      return null;
    }
  }

  /// Decode an npub1… bech32 string to its 32-byte hex pubkey.
  /// Returns null if invalid.
  String? _decodeNpub(String npub) {
    try {
      final decoded = const Bech32Codec().decode(npub, npub.length);
      if (decoded.hrp != 'npub') return null;
      final bytes = _convertBits(decoded.data, 5, 8, false);
      if (bytes.length != 32) return null;
      return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    } catch (_) {
      return null;
    }
  }

  List<int> _convertBits(List<int> data, int from, int to, bool pad) {
    var acc = 0;
    var bits = 0;
    final result = <int>[];
    final maxv = (1 << to) - 1;
    for (final v in data) {
      acc = (acc << from) | v;
      bits += from;
      while (bits >= to) {
        bits -= to;
        result.add((acc >> bits) & maxv);
      }
    }
    if (pad && bits > 0) {
      result.add((acc << (to - bits)) & maxv);
    }
    return result;
  }

  NostrEvent updateProfile(NostrProfile profile) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 0,
      content: jsonEncode(profile.toJson()),
      tags: [
        ['client', 'nostrfeed'],
      ],
    );
  }

  NostrEvent updateFollows(List<String> pubkeys) {
    ctx.requireSigning();
    final event = ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 3,
      content: '',
      tags: pubkeys.map((pk) => ['p', pk]).toList(),
    );
    // Optimistically cache the new follow list. Relays can take a moment to
    // propagate the new kind-3, and any fetchFollows during that window would
    // otherwise return the stale pre-follow list — which made the Follow
    // button appear to "unfollow" itself right after tapping.
    if (ctx.auth.pubkey != null) {
      followsCache[ctx.auth.pubkey!] = (
        follows: pubkeys,
        createdAt: event.createdAt,
      );
    }
    return event;
  }

  NostrEvent createBookmark(List<String> eventIds, List<String> addresses) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 10003,
      content: '',
      tags: [
        ...eventIds.map((id) => ['e', id]),
        ...addresses.map((a) => ['a', a]),
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Toggle bookmark for an event (add or remove from kind 10003 list).
  Future<void> toggleBookmark(
    String eventId,
    bool isCurrentlyBookmarked,
  ) async {
    ctx.requireSigning();
    final lists = await relayPool.query([
      NostrFilter(kinds: [10003], authors: [ctx.auth.pubkey!], limit: 1),
    ], timeout: const Duration(seconds: 8));
    final allIds = <String>{};
    final addresses = <String>{};
    for (final list in lists) {
      allIds.addAll(list.eventRefs);
      addresses.addAll(list.getTags('a'));
    }
    if (isCurrentlyBookmarked) {
      allIds.remove(eventId);
    } else {
      allIds.add(eventId);
    }
    final event = createBookmark(allIds.toList(), addresses.toList());
    relayPool.publish(event);
  }
}
