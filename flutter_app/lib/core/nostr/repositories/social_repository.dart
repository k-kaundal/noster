import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:bech32/bech32.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_context.dart';
import 'package:nostrfeed_mobile/core/nostr/profile_cache.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_router.dart';

class SocialRepository {
  final RelayPool relayPool;
  final NostrContext ctx;
  final RelayRouter relayRouter;

  /// Freshness caches owned by `NostrService` and injected here — see
  /// `profileCache` / `followsCache` for rationale.
  final Map<String, ({NostrProfile profile, int createdAt, int fetchedAt})>
  profileCache;
  final Map<String, ({List<String> follows, int createdAt})> followsCache;

  /// Optimistic bookmark-list cache, keyed by owner pubkey. Same problem as
  /// follows: relays take a moment to propagate a new kind-10003, and a
  /// re-read in that window would flip the bookmark icon back. Stores the
  /// full id/address sets + the list's created_at.
  final Map<String, ({Set<String> ids, Set<String> addresses, int createdAt})>
  bookmarkCache = {};

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

  /// Prefetch profiles for a whole page of authors in ONE batched relay
  /// query, filling the TTL cache so each PostCard's `profileProvider` hits
  /// the fast path instead of firing its own per-card query. This is the
  /// avatar/name half of the feed-speed fix (engagement batching is the
  /// other). Fire-and-forget from the feed; cards render with cache/fallback
  /// and fill in as the batch lands.
  Future<void> prefetchProfiles(List<String> pubkeys) async {
    if (pubkeys.isEmpty) return;
    // Only fetch authors not already fresh in the TTL cache.
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final missing = pubkeys
        .toSet()
        .where((pk) {
          final c = profileCache[pk];
          return c == null || now - c.fetchedAt >= _profileTtlSeconds;
        })
        .toList();
    if (missing.isEmpty) return;

    // ONE query for every missing author's kind-0. Relays cap filter size,
    // so chunk to stay under typical limits (a 50-author page → 2 chunks).
    const chunkSize = 40;
    for (var i = 0; i < missing.length; i += chunkSize) {
      final chunk = missing.sublist(
        i,
        i + chunkSize > missing.length ? missing.length : i + chunkSize,
      );
      try {
        final events = await relayPool.query([
          NostrFilter(kinds: [0], authors: chunk),
        ], timeout: const Duration(seconds: 5));
        // Newest kind-0 per author wins (replaceable).
        final byAuthor = <String, NostrEvent>{};
        for (final e in events) {
          final existing = byAuthor[e.pubkey];
          if (existing == null || e.createdAt > existing.createdAt) {
            byAuthor[e.pubkey] = e;
          }
        }
        final fetchedAt = DateTime.now().millisecondsSinceEpoch ~/ 1000;
        for (final entry in byAuthor.entries) {
          try {
            final profile = NostrProfile.fromJson(
              jsonDecode(entry.value.content) as Map<String, dynamic>,
            );
            _writeProfileEverywhere(
              entry.key,
              profile,
              createdAt: entry.value.createdAt,
              fetchedAt: fetchedAt,
            );
          } catch (_) {}
        }
      } catch (_) {
        // Best-effort: cards keep their cached/fallback avatar+name.
      }
    }
  }

  Future<NostrProfile?> fetchProfile(String pubkey) async {
    final cached = profileCache[pubkey];

    // TTL FAST PATH (memory): a recently-fetched profile returns with NO
    // relay round-trip (this was the main feed slowdown — every post card
    // + avatar re-queried relays on every navigation).
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    if (cached != null && now - cached.fetchedAt < _profileTtlSeconds) {
      return cached.profile;
    }

    // PERSISTENT CACHE (SQLite): the store's `profiles` table was WRITTEN
    // but never READ — every cold start re-fetched every avatar/banner from
    // relays (the "slow first paint everywhere" + "we need local cache for
    // profile data" complaint). Read-through: a stored profile renders
    // instantly and warms the memory LRU; stale rows still render NOW and
    // refresh from relays behind (stale-while-revalidate).
    if (cached == null) {
      try {
        final row = await EventStore.instance.profileRowFor(pubkey);
        if (row != null) {
          final ageMs = DateTime.now().millisecondsSinceEpoch - row.fetchedAtMs;
          final freshEnough = ageMs < _profileTtlSeconds * 1000;
          // Warm memory with the stored profile. A fresh row gets a live
          // TTL; a stale row gets an expired TTL so the NEXT call revalidates
          // — but this call serves it instantly (no relay wait).
          profileCache.cacheProfileBounded(
            pubkey,
            profile: row.profile,
            createdAt: 0, // revision unknown — any relay kind-0 wins later
            fetchedAt: freshEnough ? now : now - _profileTtlSeconds,
          );
          if (!freshEnough) {
            unawaited(_refreshProfileFromRelays(pubkey));
          }
          return row.profile;
        }
      } catch (_) {
        // Store hiccup — fall through to relays.
      }
    }

    return _refreshProfileFromRelays(pubkey, fallback: cached?.profile);
  }

  /// The relay side of profile fetch — CONCURRENT legs, first-hit wins,
  /// write-through to BOTH caches (memory LRU + SQLite persistent). Returns
  /// the freshest profile known, or [fallback] when relays have nothing.
  Future<NostrProfile?> _refreshProfileFromRelays(
    String pubkey, {
    NostrProfile? fallback,
  }) async {
    final cached = profileCache[pubkey];

    // Profile fetch — CONCURRENT, not a serial waterfall. The old code ran
    // default relays (3s) → outbox write relays (2s) → indexers (2s) one
    // after another: a miss on all three cost ~7s per profile (avatars/
    // banners stalling in). All three legs race NOW; first non-empty wins.
    final defaultLeg = relayPool.query([
      NostrFilter(kinds: [0], authors: [pubkey], limit: 1),
    ], timeout: const Duration(seconds: 3));

    final outboxLeg = relayRouter
        .getWriteRelays(pubkey)
        .timeout(const Duration(seconds: 3), onTimeout: () => <String>[])
        .then((writeRelays) async {
      if (writeRelays.isEmpty) return <NostrEvent>[];
      final results = await Future.wait(
        writeRelays.take(3).map(
              (url) => relayPool.queryOnRelay(
                url,
                [NostrFilter(kinds: [0], authors: [pubkey], limit: 1)],
                timeout: const Duration(seconds: 2),
              ),
            ),
      );
      return results.expand((e) => e).toList();
    });

    final indexerLeg = Future.wait(
      RelayRouter.indexerRelays.take(3).map(
            (url) => relayPool.queryOnRelay(
              url,
              [NostrFilter(kinds: [0], authors: [pubkey], limit: 1)],
              timeout: const Duration(seconds: 2),
            ),
          ),
    ).then((r) => r.expand((e) => e).toList());

    // First NON-EMPTY leg wins (a slow empty leg never blocks a fast hit).
    final events = await _firstNonEmpty([defaultLeg, outboxLeg, indexerLeg]);

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
          _writeProfileEverywhere(
            pubkey,
            relayProfile,
            createdAt: relayEvent.createdAt,
            fetchedAt: fetchedAt,
          );
          return relayProfile;
        }
        // Refresh the TTL so we don't re-query for another 10 minutes.
        profileCache.cacheProfileBounded(
          pubkey,
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
    return fallback ?? cached?.profile;
  }

  /// Write-through: memory LRU + the SQLite persistent profile cache (so a
  /// cold start renders avatars/banners with zero relay round-trips).
  void _writeProfileEverywhere(
    String pubkey,
    NostrProfile profile, {
    required int createdAt,
    required int fetchedAt,
  }) {
    profileCache.cacheProfileBounded(
      pubkey,
      profile: profile,
      createdAt: createdAt,
      fetchedAt: fetchedAt,
    );
    unawaited(EventStore.instance.saveProfile(pubkey, profile));
  }

  /// Returns the first future whose result is non-empty, or empty if every
  /// leg misses. All legs run concurrently (futures created by the caller
  /// BEFORE this races them) — the winner is the fastest HIT, not the first
  /// leg in list order (the old serial waterfall waited out every leg).
  static Future<List<NostrEvent>> _firstNonEmpty(
    List<Future<List<NostrEvent>>> legs,
  ) {
    final completer = Completer<List<NostrEvent>>();
    var remaining = legs.length;
    for (final leg in legs) {
      leg.then((result) {
        if (completer.isCompleted) return;
        if (result.isNotEmpty) {
          completer.complete(result);
          return;
        }
        if (--remaining == 0 && !completer.isCompleted) {
          completer.complete(const []);
        }
      }).catchError((_) {
        if (--remaining == 0 && !completer.isCompleted) {
          completer.complete(const []);
        }
      });
    }
    return completer.future;
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
    ], timeout: const Duration(seconds: 5));

    // ── 4. Client-side fallback / merge ──────────────────────────────
    // Match profiles we ALREADY hold locally (the persistent profile cache
    // warms on every feed/avatar render) — catches partial-name matches
    // even when NIP-50 isn't supported by the relay. The old code fired a
    // SECOND relay query for 500 recent kind-0s on EVERY search — a whole
    // extra waterfall per query (the "search is slow" complaint). The local
    // scan now runs ONLY over stored profiles, costs zero network, and is
    // skipped entirely when NIP-50 already filled the result set.
    final lowerQ = trimmed.toLowerCase();
    List<NostrEvent> localMatches = const [];
    if (indexerResults.length < limit) {
      localMatches =
          (await EventStore.instance.searchProfiles(lowerQ, limit: limit))
              .map((r) => _profileAsEvent(r.pubkey, r.profile))
              .toList();
    }

    // Merge indexer results with local matches, dedupe by pubkey, keep the
    // newest kind-0 per pubkey (relay hits lead; local profile rows sort
    // last via their createdAt: 0).
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

  /// Wrap a stored profile in a kind-0-shaped event so search results merge
  /// uniformly with relay kind-0s (the People tab parses content JSON back
  /// into a NostrProfile). id is synthetic but stable per pubkey.
  static NostrEvent _profileAsEvent(String pubkey, NostrProfile p) {
    return NostrEvent(
      id: 'profile-$pubkey',
      pubkey: pubkey,
      createdAt: 0, // sorts last in the newest-first merge — relay hits lead
      kind: 0,
      tags: const [],
      content: jsonEncode(p.toJson()),
      sig: '',
    );
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

  // ── NIP-51 follow sets (kind 30000) ───────────────────────────────

  /// Publish (create or replace) a follow set. The `d` tag is the identity —
  /// publishing with the same `d` replaces the old version.
  NostrEvent createFollowSet({
    required String dTag,
    required String title,
    String description = '',
    String? image,
    List<String> members = const [],
  }) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 30000,
      content: '',
      tags: [
        ['d', dTag],
        ['title', title],
        if (description.isNotEmpty) ['description', description],
        if (image != null && image.isNotEmpty) ['image', image],
        for (final pk in members) ['p', pk],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Fetch the current user's follow sets (kind 30000).
  Future<List<NostrEvent>> fetchFollowSets(String pubkey) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [30000], authors: [pubkey], limit: 100),
    ], timeout: const Duration(seconds: 8));
    // One set per d tag (newest version wins).
    final byD = <String, NostrEvent>{};
    for (final e in events) {
      final d = e.getTag('d') ?? '';
      final existing = byD[d];
      if (existing == null || e.createdAt > existing.createdAt) byD[d] = e;
    }
    final lists = byD.values.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return lists;
  }

  /// Delete a follow set (NIP-09 deletion request).
  NostrEvent deleteFollowSet(String eventId) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 5,
      content: 'list deleted',
      tags: [
        ['e', eventId],
        ['client', 'nostrfeed'],
      ],
    );
  }

  // ── NIP-99 classified listings + NIP-69 P2P orders ────────────────

  /// Create a NIP-99 classified listing (kind 30402, addressable).
  NostrEvent createListing({
    required String dTag,
    required String title,
    required String description,
    String? summary,
    String? image,
    String? location,
    String? priceAmount,
    String? priceCurrency,
    String? priceFrequency,
    List<String> hashtags = const [],
  }) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 30402,
      content: description,
      tags: [
        ['d', dTag],
        ['title', title],
        if (summary != null && summary.isNotEmpty) ['summary', summary],
        [
          'published_at',
          '${DateTime.now().millisecondsSinceEpoch ~/ 1000}',
        ],
        if (image != null && image.isNotEmpty) ['image', image],
        if (location != null && location.isNotEmpty) ['location', location],
        if (priceAmount != null && priceCurrency != null)
          [
            'price',
            priceAmount,
            priceCurrency,
            ?priceFrequency,
          ],
        ['status', 'active'],
        for (final t in hashtags) ['t', t.toLowerCase()],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Create a NIP-69 P2P trade order (kind 38383, addressable).
  NostrEvent createP2POrder({
    required String type, // 'buy' | 'sell'
    required String currency,
    String? amountSats,
    String? fiatAmount,
    List<String> paymentMethods = const [],
    String? premium,
    String? makerName,
  }) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 38383,
      content: '',
      tags: [
        ['d', 'order-${DateTime.now().millisecondsSinceEpoch}'],
        ['k', type],
        ['f', currency.toLowerCase()],
        ['s', 'pending'],
        ['amt', amountSats ?? '0'],
        if (fiatAmount != null && fiatAmount.isNotEmpty) ['fa', fiatAmount],
        for (final pm in paymentMethods) ['pm', pm],
        if (premium != null && premium.isNotEmpty) ['premium', premium],
        ['network', 'mainnet'],
        ['layer', 'lightning'],
        if (makerName != null && makerName.isNotEmpty) ['name', makerName],
        ['y', 'nostrfeed'],
        ['z', 'order'],
        ['client', 'nostrfeed'],
      ],
    );
  }

  // ── NIP-29 relay groups ───────────────────────────────────────────

  /// Join a group (kind 9021 join request with optional invite code).
  NostrEvent createGroupJoinRequest(String groupId, {String? inviteCode}) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 9021,
      content: '',
      tags: [
        ['h', groupId],
        if (inviteCode != null && inviteCode.isNotEmpty) ['code', inviteCode],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Leave a group (kind 9022 leave request).
  NostrEvent createGroupLeaveRequest(String groupId) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 9022,
      content: '',
      tags: [
        ['h', groupId],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Check if a pubkey is a member of a group (from kind 39002 member list).
  Future<bool> isGroupMember(String groupId, String pubkey) async {
    final members = await fetchGroupMembers(groupId);
    return members.contains(pubkey);
  }

  /// Fetch group members (kind 39002 p tags).
  Future<List<String>> fetchGroupMembers(String groupId) async {
    final events = await relayPool.query([
      NostrFilter(
        kinds: [39002],
        tagFilters: {
          'd': [groupId],
        },
        limit: 1,
      ),
    ], timeout: const Duration(seconds: 5));
    if (events.isEmpty) return [];
    // Newest version of the member list.
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events.first.getTags('p');
  }

  /// Fetch group admins with roles (kind 39001 p tags with role markers).
  Future<Map<String, List<String>>> fetchGroupAdmins(String groupId) async {
    final events = await relayPool.query([
      NostrFilter(
        kinds: [39001],
        tagFilters: {
          'd': [groupId],
        },
        limit: 1,
      ),
    ], timeout: const Duration(seconds: 5));
    if (events.isEmpty) return {};
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    final result = <String, List<String>>{};
    for (final tag in events.first.tags) {
      if (tag.isNotEmpty && tag[0] == 'p' && tag.length > 1) {
        result[tag[1]] = tag.length > 2 ? tag.sublist(2) : [];
      }
    }
    return result;
  }

  // ── NIP-29 moderation (admin actions, kinds 9000-9020) ────────────

  /// Add/update a user in the group (kind 9000 put-user, admin only).
  NostrEvent createGroupPutUser(
    String groupId,
    String targetPubkey, {
    List<String> roles = const [],
    String reason = '',
  }) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 9000,
      content: reason,
      tags: [
        ['h', groupId],
        ['p', targetPubkey, ...roles],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Remove a user from the group (kind 9001 remove-user, admin only).
  NostrEvent createGroupRemoveUser(
    String groupId,
    String targetPubkey, {
    String reason = '',
  }) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 9001,
      content: reason,
      tags: [
        ['h', groupId],
        ['p', targetPubkey],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Delete a message in the group (kind 9005 delete-event, admin only).
  NostrEvent createGroupDeleteEvent(String groupId, String eventId) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 9005,
      content: '',
      tags: [
        ['h', groupId],
        ['e', eventId],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Pick the NEWEST revision of a replaceable kind-10003 list across every
  /// relay. The whole bug this guards against: kind 10003 is replaceable, so
  /// each relay can hold a different revision, and `limit: 1` picks one at
  /// random — often a stale one — and writing from it resurrects
  /// long-deleted bookmarks and drops newer ones.
  ///
  /// Pure, so the invariant is unit-testable without a relay pool.
  static NostrEvent? newestBookmarkRevision(List<NostrEvent> events) {
    if (events.isEmpty) return null;
    var newest = events.first;
    for (final e in events) {
      if (e.createdAt > newest.createdAt) newest = e;
    }
    return newest;
  }

  /// Read the user's bookmark list as it actually stands: the union of every
  /// revision relays hold, resolved to the NEWEST. The optimistic cache
  /// covers the propagation window after our own write (same pattern as
  /// fetchFollows).
  Future<({Set<String> ids, Set<String> addresses})> _readBookmarks(
      String pubkey) async {
    // Optimistic fast path: our own recent write outranks any relay revision.
    final cached = bookmarkCache[pubkey];

    final events = await relayPool.query([
      NostrFilter(kinds: [10003], authors: [pubkey]),
    ], timeout: const Duration(seconds: 8));

    final newest = newestBookmarkRevision(events);
    if (newest != null) {
      // Accept the relay revision only when it's at least as new as our own
      // optimistic write; otherwise ours is fresher — keep it.
      if (cached == null || newest.createdAt >= cached.createdAt) {
        final ids = newest.eventRefs.toSet();
        final addresses = newest.getTags('a').toSet();
        bookmarkCache[pubkey] = (
          ids: ids,
          addresses: addresses,
          createdAt: newest.createdAt,
        );
        return (ids: ids, addresses: addresses);
      }
      return (ids: cached.ids, addresses: cached.addresses);
    }

    // Relays have nothing — our optimistic list (if any) is all there is.
    return cached == null
        ? (ids: <String>{}, addresses: <String>{})
        : (ids: cached.ids, addresses: cached.addresses);
  }

  /// Toggle bookmark for an event (add or remove from kind 10003 list).
  ///
  /// Awaited so the caller's "removed/saved" toast only fires once the write
  /// is actually out — and so a failed publish surfaces rather than lying.
  Future<void> toggleBookmark(
    String eventId,
    bool isCurrentlyBookmarked,
  ) async {
    ctx.requireSigning();
    final pubkey = ctx.auth.pubkey!;
    final current = await _readBookmarks(pubkey);
    final allIds = current.ids;
    final addresses = current.addresses;
    if (isCurrentlyBookmarked) {
      allIds.remove(eventId);
    } else {
      allIds.add(eventId);
    }
    final event = createBookmark(allIds.toList(), addresses.toList());
    // publishWithAck — confirms at least one relay accepted before the
    // caller's toast fires, and throws if none did (so a failed save isn't
    // reported as saved).
    await relayPool.publishWithAck(event);
    // Optimistically cache the new list so an immediate re-read doesn't flip
    // the icon back while relays propagate.
    bookmarkCache[pubkey] = (
      ids: allIds,
      addresses: addresses,
      createdAt: event.createdAt,
    );
  }

  /// The current bookmarked event ids (for the icon's filled/outline state).
  Future<Set<String>> fetchBookmarkedIds(String pubkey) async {
    return (await _readBookmarks(pubkey)).ids;
  }

  // ── Studio: subscription tiers (kind 37001) + zap goals (kind 9041) ──

  /// Publish (or replace) a subscription tier. The `d` tag is the identity —
  /// publishing with the same slug replaces the old version.
  NostrEvent createTier(List<List<String>> tags, {String content = ''}) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 37001,
      content: content,
      tags: [
        ...tags,
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Publish a zap goal (NIP-75, kind 9041).
  NostrEvent createGoal(List<List<String>> tags, {String content = ''}) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 9041,
      content: content,
      tags: [
        ...tags,
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Announce a goal as an ordinary kind-1 note carrying a `goal` tag — the
  /// thing that makes it fundable by clients that have never heard of NIP-75.
  /// Zaps on the note count toward the goal.
  NostrEvent announceGoal({
    required String goalId,
    String? relayHint,
    required String content,
  }) {
    ctx.requireSigning();
    return ctx.authService.signEvent(
      privateKey: ctx.auth.privateKey!,
      kind: 1,
      content: content,
      tags: [
        ['goal', goalId, ?relayHint],
        ['client', 'nostrfeed'],
      ],
    );
  }
}
