import 'dart:async';
import 'dart:convert';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_context.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';
import 'package:nostrfeed_mobile/core/nostr/repositories/feed_repository.dart';
import 'package:nostrfeed_mobile/core/nostr/repositories/engagement_repository.dart';
import 'package:nostrfeed_mobile/core/nostr/repositories/social_repository.dart';
import 'package:nostrfeed_mobile/core/nostr/repositories/dm_repository.dart';

export 'package:nostrfeed_mobile/core/nostr/repositories/feed_repository.dart'
    show HashtagStat;
export 'package:nostrfeed_mobile/core/nostr/repositories/engagement_repository.dart'
    show EventEngagement;
export 'package:nostrfeed_mobile/core/nostr/repositories/dm_repository.dart'
    show DecryptedDm;

/// Central Nostr service — combines relay pool, auth, and all Nostr operations.
class NostrService {
  final RelayPool relayPool;
  final AuthService authService;
  AuthState _auth = const AuthState();
  bool _initialized = false;
  late final NostrContext _ctx;

  // Repositories
  late final FeedRepository feed;
  late final EngagementRepository engagement;
  late final SocialRepository social;
  late final DmRepository dms;

  /// In-memory cache of the latest known profile per pubkey, with the
  /// `created_at` timestamp of the kind-0 event it came from. Used to prefer
  /// locally-known fresher data over possibly-stale relay responses right
  /// after a profile update (relays can lag for a few seconds).
  ///
  /// Instance state (was a global static map) — owned by this service and
  /// shared with [SocialRepository] via constructor injection.
  final Map<String, ({NostrProfile profile, int createdAt})> profileCache = {};

  /// In-memory cache of the latest known follow list per pubkey, with the
  /// `created_at` timestamp of the kind-3 event it came from. Same purpose
  /// as [profileCache]: right after a follow/unfollow, a relay may still be
  /// serving the previous kind-3, and we don't want the UI to flip back.
  final Map<String, ({List<String> follows, int createdAt})> followsCache = {};

  NostrService({List<String>? relays})
    : relayPool = RelayPool(relays: relays),
      authService = AuthService() {
    relayPool.authHandler = _handleRelayAuth;
    _ctx = NostrContext(authService, () => _auth);
    engagement = EngagementRepository(relayPool);
    feed = FeedRepository(relayPool, engagement);
    social = SocialRepository(relayPool, _ctx, profileCache, followsCache);
    dms = DmRepository(_ctx);
  }

  AuthState get auth => _auth;
  bool get isLoggedIn => _auth.isLoggedIn;
  bool get canSign =>
      _auth.isLoggedIn && !_auth.isReadOnly && _auth.privateKey != null;
  bool get isInitialized => _initialized;

  Future<void> init() async {
    if (_initialized) return;

    // Try to load stored auth — don't fail if storage is unavailable
    try {
      _auth = await authService.getStoredAuth();
    } catch (_) {
      _auth = const AuthState();
    }

    // Connect to relays — this never throws
    relayPool.connectAll().catchError((_) {});

    // Wait until at least 1 relay connects (max 5 seconds)
    for (var i = 0; i < 50; i++) {
      if (relayPool.connectedCount > 0) break;
      await Future.delayed(const Duration(milliseconds: 100));
    }

    _initialized = true;
  }

  Future<void> setAuth(AuthState auth) async {
    _auth = auth;
  }

  /// NIP-42 relay auth handler.
  Future<NostrEvent> _handleRelayAuth(String relayUrl, String challenge) async {
    if (!canSign) throw StateError('Not logged in');
    return authService.signRelayAuth(
      privateKey: _auth.privateKey!,
      relayUrl: relayUrl,
      challenge: challenge,
    );
  }

  // ── Publishing ──────────────────────────────────────────────────────

  void publish(NostrEvent event) {
    relayPool.publish(event);
  }

  /// Publish and wait for at least one relay to accept the event.
  /// Use this for anything the user expects to be delivered (DMs, posts).
  Future<bool> publishWithAck(NostrEvent event) =>
      relayPool.publishWithAck(event);

  NostrEvent createPost(String content, {List<List<String>>? tags}) {
    _requireSigning();
    final allTags = <List<String>>[
      ...?tags,
      ['client', 'nostrfeed'],
    ];
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 1,
      content: content,
      tags: allTags,
    );
  }

  NostrEvent createReply(
    String content,
    String replyToId,
    String replyToPubkey, {
    String? rootId,
  }) {
    _requireSigning();
    final tags = <List<String>>[
      if (rootId != null) ['e', rootId, '', 'root'],
      ['e', replyToId, '', 'reply'],
      ['p', replyToPubkey],
      ['client', 'nostrfeed'],
    ];
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 1,
      content: content,
      tags: tags,
    );
  }

  NostrEvent createRepost(NostrEvent event) {
    _requireSigning();
    // Kind 1 posts use kind 6 reposts; everything else uses kind 16 generic reposts.
    final isKind1 = event.kind == 1;
    final kind = isKind1 ? 6 : 16;
    final tags = <List<String>>[
      ['e', event.id],
      ['p', event.pubkey],
      // For addressable events (30000-39999), include the 'a' coordinate so
      // clients can resolve the addressable event properly (NIP-18).
      if (event.kind >= 30000 && event.kind < 40000)
        ['a', '${event.kind}:${event.pubkey}:${event.getTag('d') ?? ''}'],
      ['k', '${event.kind}'],
      ['client', 'nostrfeed'],
    ];
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: kind,
      content: jsonEncode(event.toJson()),
      tags: tags,
    );
  }

  /// NIP-22 comment (kind 1111) on any event. For addressable events
  /// (articles, etc.) uses 'A'/'a' root scope tags per NIP-22.
  NostrEvent createComment({
    required String content,
    required NostrEvent root,
    NostrEvent? parent,
  }) {
    _requireSigning();
    final tags = <List<String>>[];

    final isAddressable = root.kind >= 30000 && root.kind < 40000;
    if (isAddressable) {
      final d = root.getTag('d') ?? '';
      final coord = '${root.kind}:${root.pubkey}:$d';
      // Root scope
      tags.add(['A', coord]);
      tags.add(['K', '${root.kind}']);
      tags.add(['P', root.pubkey]);
      if (parent != null && parent.id != root.id) {
        // Replying to another comment
        tags.add(['a', coord]);
        tags.add(['e', parent.id]);
        tags.add(['k', '${parent.kind}']);
        tags.add(['p', parent.pubkey]);
      } else {
        // Direct reply to root
        tags.add(['a', coord]);
        tags.add(['k', '${root.kind}']);
        tags.add(['p', root.pubkey]);
      }
    } else {
      // Regular event root
      tags.add(['E', root.id]);
      tags.add(['K', '${root.kind}']);
      tags.add(['P', root.pubkey]);
      if (parent != null && parent.id != root.id) {
        tags.add(['e', parent.id]);
        tags.add(['k', '${parent.kind}']);
        tags.add(['p', parent.pubkey]);
      } else {
        tags.add(['e', root.id]);
        tags.add(['k', '${root.kind}']);
        tags.add(['p', root.pubkey]);
      }
    }

    tags.add(['client', 'nostrfeed']);

    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 1111,
      content: content,
      tags: tags,
    );
  }

  NostrEvent createReaction(NostrEvent event, {String content = '+'}) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 7,
      content: content,
      tags: [
        ['e', event.id],
        ['p', event.pubkey],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// NIP-09 deletion request (kind 5) — asks relays to delete an event.
  /// Used for unlike/unrepost by deleting the user's own reaction/repost.
  NostrEvent createDeletion(String eventId, {String? reason}) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 5,
      content: reason ?? '',
      tags: [
        ['e', eventId],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// NIP-52 time-based calendar event (kind 31923, addressable).
  NostrEvent createCalendarEvent({
    required String title,
    required int start,
    String? location,
    String description = '',
    String? identifier,
  }) {
    _requireSigning();
    final d =
        identifier ??
        'event-${DateTime.now().millisecondsSinceEpoch}-${_auth.pubkey!.substring(0, 8)}';
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 31923,
      content: description,
      tags: [
        ['d', d],
        ['title', title],
        ['start', '$start'],
        if (location != null && location.isNotEmpty) ['location', location],
        ['client', 'nostrfeed'],
      ],
    );
  }

  NostrEvent createArticle({
    required String title,
    required String content,
    String? summary,
    String? image,
    List<String>? hashtags,
    String? dTag,
  }) {
    _requireSigning();
    final d = dTag ?? randomHex(8);
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 30023,
      content: content,
      tags: [
        ['d', d],
        ['title', title],
        if (summary != null) ['summary', summary],
        if (image != null) ['image', image],
        ...?hashtags?.map((t) => ['t', t.toLowerCase()]),
        ['published_at', '${DateTime.now().millisecondsSinceEpoch ~/ 1000}'],
        ['client', 'nostrfeed'],
      ],
    );
  }

  void _requireSigning() {
    if (!canSign) throw StateError('Must be logged in with signing key');
  }

  // ── Delegated queries ───────────────────────────────────────────────

  Future<NostrProfile?> fetchProfile(String pubkey) =>
      social.fetchProfile(pubkey);

  Future<List<NostrEvent>> fetchFeed({
    int limit = 50,
    int? since,
    int? until,
    List<String>? authors,
  }) => feed.fetchFeed(limit: limit, since: since, until: until, authors: authors);

  Future<List<NostrEvent>> fetchFollowingFeed(
    List<String> followedPubkeys, {
    int limit = 50,
    int? until,
  }) => feed.fetchFollowingFeed(followedPubkeys, limit: limit, until: until);

  /// Fetch NIP-22 comments (kind 1111) for a root event. For addressable
  /// roots pass the full `kind:pubkey:d` coordinate; for regular events pass
  /// the event id.
  Future<List<NostrEvent>> fetchComments(
    String idOrCoordinate, {
    bool isAddressable = false,
    int limit = 100,
  }) => feed.fetchComments(idOrCoordinate, isAddressable: isAddressable, limit: limit);

  Future<List<NostrEvent>> fetchReplies(String eventId) =>
      feed.fetchReplies(eventId);

  Future<List<NostrEvent>> fetchReactions(String eventId) =>
      feed.fetchReactions(eventId);

  Future<List<NostrEvent>> fetchReposts(String eventId) =>
      feed.fetchReposts(eventId);

  Future<List<String>> fetchFollows(String pubkey) =>
      social.fetchFollows(pubkey);

  Future<List<String>> fetchFollowers(String pubkey) =>
      social.fetchFollowers(pubkey);

  Future<List<NostrEvent>> fetchNotifications(
    String pubkey, {
    int limit = 50,
  }) => feed.fetchNotifications(pubkey, limit: limit);

  Future<List<NostrEvent>> search(String query, {int limit = 50}) =>
      feed.search(query, limit: limit);

  /// People search. Most relays do NOT support NIP-50 `search` on kind 0
  /// (profile metadata) — so this uses multiple strategies in order:
  ///
  /// 1. Direct identifier: `npub1…` or 64-char hex pubkey → fetch by author
  /// 2. NIP-05 address (`alice@domain.com` or `domain.com`) → HTTP lookup
  /// 3. NIP-50 search against connected relays
  /// 4. Client-side fallback: fetch recent kind-0s and filter by name /
  ///    display_name / nip05 / about containing the query
  Future<List<NostrEvent>> searchUsers(String query, {int limit = 20}) =>
      social.searchUsers(query, limit: limit);

  Future<List<NostrEvent>> fetchBookmarks(String pubkey) =>
      feed.fetchBookmarks(pubkey);

  Future<List<NostrEvent>> fetchDMs(String pubkey, {int limit = 50}) =>
      feed.fetchDMs(pubkey, limit: limit);

  Future<List<NostrEvent>> fetchHashtagFeed(
    String tag, {
    int limit = 50,
  }) => feed.fetchHashtagFeed(tag, limit: limit);

  Future<List<NostrEvent>> fetchCommunities({int limit = 50}) =>
      feed.fetchCommunities(limit: limit);

  Future<List<NostrEvent>> fetchArticles({int limit = 50}) =>
      feed.fetchArticles(limit: limit);

  /// Fetch trending posts sorted by engagement score (replies + reactions +
  /// reposts + zaps weighted by recency). Uses a time-decay algorithm similar
  /// to Hacker News / Reddit: score = (engagement + 1) / (age_hours + 2)^1.8.
  Future<List<NostrEvent>> fetchTrending({
    int limit = 50,
    int hours = 24,
  }) => feed.fetchTrending(limit: limit, hours: hours);

  Future<List<NostrEvent>> fetchZapReceipts(
    String targetId, {
    bool isEvent = true,
  }) => engagement.fetchZapReceipts(targetId, isEvent: isEvent);

  Future<List<NostrEvent>> fetchLists(String pubkey) =>
      feed.fetchLists(pubkey);

  Future<List<NostrEvent>> fetchCalendarEvents({int limit = 50}) =>
      feed.fetchCalendarEvents(limit: limit);

  Future<List<NostrEvent>> fetchGroups({int limit = 50}) =>
      feed.fetchGroups(limit: limit);

  Future<List<NostrEvent>> fetchMarketListings({int limit = 50}) =>
      feed.fetchMarketListings(limit: limit);

  Future<List<NostrEvent>> fetchLiveStreams({int limit = 20}) =>
      feed.fetchLiveStreams(limit: limit);

  /// Fetch a single event by ID.
  Future<NostrEvent?> fetchEventById(String id) =>
      feed.fetchEventById(id);

  /// Fetch events by IDs (batch).
  Future<List<NostrEvent>> fetchEventsByIds(List<String> ids) =>
      feed.fetchEventsByIds(ids);

  /// Fetch engagement (replies + reactions + reposts + zaps) for an event.
  Future<EventEngagement> fetchEngagement(String eventId) =>
      engagement.fetchEngagement(eventId);

  /// Engagement for an addressable event (30000-39999). Looks up by 'a' tag.
  Future<EventEngagement> fetchEngagementForAddress(String coordinate) =>
      engagement.fetchEngagementForAddress(coordinate);

  /// Fetch engagement for multiple events in a single batched query.
  /// Returns a map of eventId → engagement stats.
  Future<Map<String, EventEngagement>> fetchEngagementBatch(
    List<String> eventIds,
  ) => engagement.fetchEngagementBatch(eventIds);

  /// Check if the current user has liked or reposted specific events.
  /// Returns maps of eventId → true/false for likes and reposts.
  Future<({Map<String, bool> likes, Map<String, bool> reposts})>
  fetchUserInteractions(List<String> eventIds, String userPubkey) =>
      engagement.fetchUserInteractions(eventIds, userPubkey);

  /// Fetch video/reel events (kind 1 with media URLs or kind 21/22 video).
  Future<List<NostrEvent>> fetchVideos({int limit = 50}) =>
      feed.fetchVideos(limit: limit);

  /// Fetch popular hashtags from recent events.
  /// Properly filters by time window and includes engagement weighting.
  Future<List<HashtagStat>> fetchTrendingHashtags({
    int limit = 20,
    int hours = 24,
  }) => feed.fetchTrendingHashtags(limit: limit, hours: hours);

  // ── Delegated signing methods ───────────────────────────────────────

  NostrEvent updateProfile(NostrProfile profile) =>
      social.updateProfile(profile);

  NostrEvent updateFollows(List<String> pubkeys) =>
      social.updateFollows(pubkeys);

  NostrEvent createBookmark(List<String> eventIds, List<String> addresses) =>
      social.createBookmark(eventIds, addresses);

  /// Toggle bookmark for an event (add or remove from kind 10003 list).
  Future<void> toggleBookmark(
    String eventId,
    bool isCurrentlyBookmarked,
  ) => social.toggleBookmark(eventId, isCurrentlyBookmarked);

  /// NIP-04 encrypted DM (kind 4).
  NostrEvent createEncryptedDm(String peerPubkey, String plaintext) =>
      dms.createEncryptedDm(peerPubkey, plaintext);

  /// NIP-17 gift-wrapped DM (kind 1059) — modern, metadata-private.
  /// Most current clients (Amethyst, 0xchat, Damus) send DMs this way.
  NostrEvent createNip17Dm(String peerPubkey, String plaintext) =>
      dms.createNip17Dm(peerPubkey, plaintext);

  /// Decrypt a DM event from the current user's perspective.
  ///
  /// Handles both:
  ///  - kind 4 (legacy NIP-04, AES-256-CBC)
  ///  - kind 1059 (NIP-17 gift wrap, NIP-44 + seal + gift)
  ///
  /// Returns a record with the plaintext, the real sender pubkey (from the
  /// inner rumor for NIP-17), and the rumor timestamp. Returns null on
  /// failure.
  Future<DecryptedDm?> decryptDm(NostrEvent event) => dms.decryptDm(event);
}
