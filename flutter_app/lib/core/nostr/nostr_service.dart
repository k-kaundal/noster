import 'dart:async';
import 'dart:convert';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/core/nostr/dm_delivery.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_context.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_router.dart';
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

  /// DM delivery routing (recipient inbox relays + Primal fallbacks).
  late final DmDelivery dmDelivery;

  /// NIP-65 outbox routing (per-user write/read relays).
  late final RelayRouter relayRouter;

  /// In-memory cache of the latest known profile per pubkey: the kind-0
  /// `created_at` (freshness vs relay revisions) plus a local `fetchedAt`
  /// wall-clock timestamp for TTL-based fast paths.
  ///
  /// Instance state (was a global static map) — owned by this service and
  /// shared with [SocialRepository] via constructor injection.
  final Map<String, ({NostrProfile profile, int createdAt, int fetchedAt})>
  profileCache = {};

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
    // relayRouter must exist before SocialRepository (it's a constructor arg).
    relayRouter = RelayRouter(relayPool);
    social = SocialRepository(
      relayPool,
      _ctx,
      profileCache,
      followsCache,
      relayRouter,
    );
    dms = DmRepository(_ctx);
    dmDelivery = DmDelivery(relayPool);
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

  /// NIP-65-aware publish for events that tag other users (reactions,
  /// replies, reposts, comments, deletions).
  ///
  /// Per NIP-65, an event tagging a user should be published to:
  ///  1. The author's write relays — our connected defaults (immediate).
  ///  2. Each tagged user's READ relays — looked up in the background and
  ///     republished there, so recipients on other relays (e.g. a Primal
  ///     user who only watches relay.primal.net) actually get notified.
  ///
  /// Returns the immediate ack from our connected relays; the outbox-model
  /// republish is fire-and-forget and never blocks the UI.
  Future<bool> publishEvent(NostrEvent event) async {
    // 1. Immediate publish to connected relays (includes the big public
    //    ones most users read: damus, primal, nostr.band).
    final ackFuture = relayPool.publishWithAck(event);

    // 2. Background: tagged users' read relays (NIP-65 outbox model).
    final recipients = event.pubkeyRefs
        .where((pk) => pk != _auth.pubkey)
        .toSet()
        .toList();
    if (recipients.isNotEmpty) {
      Future(() async {
        try {
          final extra = <String>{};
          for (final pk in recipients.take(5)) {
            extra.addAll(await relayRouter.getReadRelays(pk));
          }
          final targets = extra
              .where((u) => !relayPool.connectedUrls.contains(u))
              .take(6)
              .toList();
          if (targets.isNotEmpty) {
            await relayPool.publishWithAckTo(event, targets);
          }
        } catch (_) {
          // Outbox republish is best-effort — the event is already out.
        }
      }).ignore();
    }

    return ackFuture;
  }

  /// Publish and wait for at least one relay to accept the event.
  /// Use this for anything the user expects to be delivered (DMs, posts).
  Future<bool> publishWithAck(NostrEvent event) =>
      relayPool.publishWithAck(event);

  /// NIP-71 video event (kind 22 = short-form portrait / reel, kind 21 =
  /// landscape). The playable URL + poster + metadata live in the `imeta`
  /// tag (NIP-92); [caption] is the content.
  NostrEvent createVideoEvent({
    required String url,
    required String mimeType,
    String caption = '',
    String? posterUrl,
    double? durationSec,
    List<String>? hashtags,
    bool isShortForm = true,
  }) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: isShortForm ? 22 : 21,
      content: caption,
      tags: [
        ['title', caption.isEmpty ? 'Video' : caption],
        ['published_at', '${DateTime.now().millisecondsSinceEpoch ~/ 1000}'],
        [
          'imeta',
          'url $url',
          'm $mimeType',
          if (posterUrl != null) 'image $posterUrl',
          if (durationSec != null)
            'duration ${durationSec.toStringAsFixed(2)}',
        ],
        ...?hashtags?.map((t) => ['t', t.toLowerCase()]),
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// NIP-29 group chat message (kind 9) tagged with the group's `h` id.
  /// NIP-53 live chat message (kind 1311) bound to a live activity.
  NostrEvent createLiveChatMessage(
    String coordinate,
    String content, {
    String? replyToId,
  }) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 1311,
      content: content,
      tags: [
        ['a', coordinate, '', 'root'],
        if (replyToId != null) ['e', replyToId, '', 'reply'],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Fetch live chat messages for an activity coordinate.
  Future<List<NostrEvent>> fetchLiveChat(String coordinate, {int limit = 100}) =>
      feed.fetchLiveChat(coordinate, limit: limit);

  /// Live subscription for new live chat messages.
  Stream<NostrEvent> subscribeLiveChat(String coordinate) =>
      feed.subscribeLiveChat(coordinate);

  NostrEvent createGroupChatMessage(
    String groupId,
    String content, {
    String? replyToId,
    String? replyToPubkey,
  }) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 9,
      content: content,
      tags: [
        ['h', groupId],
        if (replyToId != null) ['e', replyToId, '', 'reply'],
        if (replyToPubkey != null) ['p', replyToPubkey],
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// Fetch NIP-29 group chat history.
  Future<List<NostrEvent>> fetchGroupChat(String groupId, {int limit = 100}) =>
      feed.fetchGroupChat(groupId, limit: limit);

  /// Live subscription for new NIP-29 group chat messages.
  Stream<NostrEvent> subscribeGroupChat(String groupId) =>
      feed.subscribeGroupChat(groupId);

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

  /// Sign an arbitrary kind — for event types without a dedicated factory
  /// (subscription tiers, zap goals, zap requests, deletion requests…).
  NostrEvent createEvent({
    required int kind,
    required String content,
    List<List<String>> tags = const [],
  }) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: kind,
      content: content,
      tags: tags,
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
  /// NIP-56 report (kind 1984) on an event, a profile, or both.
  ///
  /// Google Play's child-safety review requires a working in-app report
  /// flow — this publishes the report so relays and other clients see it.
  /// [reportType] is a NIP-56 type string (see `report_types.dart`).
  NostrEvent createReport({
    String? eventId,
    String? pubkey,
    required String reportType,
    String reason = '',
  }) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 1984,
      content: reason,
      tags: [
        if (eventId != null) ['e', eventId, '', reportType],
        if (pubkey != null) ['p', pubkey, reportType],
        ['client', 'nostrfeed'],
      ],
    );
  }

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
    int? end,
    String? location,
    String description = '',
    String? identifier,
    List<String>? hashtags,
  }) {
    _requireSigning();
    final d =
        identifier ??
        'event-${DateTime.now().millisecondsSinceEpoch}-${_auth.pubkey!.substring(0, 8)}';
    // NIP-52: D tags index the event by day (unix ts at day granularity).
    final dayTs = (start ~/ 86400) * 86400;
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 31923,
      content: description,
      tags: [
        ['d', d],
        ['title', title],
        ['start', '$start'],
        if (end != null) ['end', '$end'],
        ['D', '$dayTs'],
        if (location != null && location.isNotEmpty) ['location', location],
        ...?hashtags?.map((t) => ['t', t.toLowerCase()]),
        ['client', 'nostrfeed'],
      ],
    );
  }

  /// NIP-52 RSVP (kind 31925, addressable): respond to a calendar event.
  /// [status] is 'accepted', 'tentative', or 'declined'.
  NostrEvent createCalendarRsvp({
    required NostrEvent calendarEvent,
    required String status,
    String note = '',
  }) {
    _requireSigning();
    final d = calendarEvent.getTag('d') ?? '';
    final coordinate = '${calendarEvent.kind}:${calendarEvent.pubkey}:$d';
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 31925,
      content: note,
      tags: [
        ['a', coordinate],
        ['e', calendarEvent.id],
        [
          'd',
          'rsvp-${DateTime.now().millisecondsSinceEpoch}-${_auth.pubkey!.substring(0, 8)}',
        ],
        ['status', status],
        ['p', calendarEvent.pubkey],
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

  // ── NIP-51 follow sets ─────────────────────────────────────────────

  NostrEvent createFollowSet({
    required String dTag,
    required String title,
    String description = '',
    String? image,
    List<String> members = const [],
  }) =>
      social.createFollowSet(
        dTag: dTag,
        title: title,
        description: description,
        image: image,
        members: members,
      );

  Future<List<NostrEvent>> fetchFollowSets(String pubkey) =>
      social.fetchFollowSets(pubkey);

  NostrEvent deleteFollowSet(String eventId) => social.deleteFollowSet(eventId);

  /// Create a NIP-29 group (kind 39000 metadata). Note: on most relays the
  /// relay master key owns group metadata — client-created groups work on
  /// relays that accept user-published kind 39000 (open/group relays).
  NostrEvent createGroup({
    required String groupId,
    required String name,
    String about = '',
    String? picture,
    bool isOpen = true,
    bool isPublic = true,
  }) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 39000,
      content: '',
      tags: [
        ['d', groupId],
        ['name', name],
        if (about.isNotEmpty) ['about', about],
        if (picture != null && picture.isNotEmpty) ['picture', picture],
        if (isOpen) ['open', ''] else ['closed', ''],
        if (isPublic) ['public', ''] else ['private', ''],
        ['client', 'nostrfeed'],
      ],
    );
  }

  // ── NIP-99 listings + NIP-69 P2P orders ───────────────────────────

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
  }) =>
      social.createListing(
        dTag: dTag,
        title: title,
        description: description,
        summary: summary,
        image: image,
        location: location,
        priceAmount: priceAmount,
        priceCurrency: priceCurrency,
        priceFrequency: priceFrequency,
        hashtags: hashtags,
      );

  NostrEvent createP2POrder({
    required String type,
    required String currency,
    String? amountSats,
    String? fiatAmount,
    List<String> paymentMethods = const [],
    String? premium,
    String? makerName,
  }) =>
      social.createP2POrder(
        type: type,
        currency: currency,
        amountSats: amountSats,
        fiatAmount: fiatAmount,
        paymentMethods: paymentMethods,
        premium: premium,
        makerName: makerName,
      );

  Future<List<NostrEvent>> fetchP2POrders({int limit = 50}) =>
      feed.fetchP2POrders(limit: limit);

  // ── NIP-29 relay groups ───────────────────────────────────────────

  NostrEvent createGroupJoinRequest(String groupId, {String? inviteCode}) =>
      social.createGroupJoinRequest(groupId, inviteCode: inviteCode);

  NostrEvent createGroupLeaveRequest(String groupId) =>
      social.createGroupLeaveRequest(groupId);

  Future<bool> isGroupMember(String groupId, String pubkey) =>
      social.isGroupMember(groupId, pubkey);

  Future<List<String>> fetchGroupMembers(String groupId) =>
      social.fetchGroupMembers(groupId);

  Future<Map<String, List<String>>> fetchGroupAdmins(String groupId) =>
      social.fetchGroupAdmins(groupId);

  NostrEvent createGroupPutUser(
    String groupId,
    String targetPubkey, {
    List<String> roles = const [],
    String reason = '',
  }) =>
      social.createGroupPutUser(
        groupId,
        targetPubkey,
        roles: roles,
        reason: reason,
      );

  NostrEvent createGroupRemoveUser(
    String groupId,
    String targetPubkey, {
    String reason = '',
  }) =>
      social.createGroupRemoveUser(groupId, targetPubkey, reason: reason);

  NostrEvent createGroupDeleteEvent(String groupId, String eventId) =>
      social.createGroupDeleteEvent(groupId, eventId);

  /// Toggle bookmark for an event (add or remove from kind 10003 list).
  /// Awaited — the caller's toast only fires once the write is actually out.
  Future<void> toggleBookmark(
    String eventId,
    bool isCurrentlyBookmarked,
  ) => social.toggleBookmark(eventId, isCurrentlyBookmarked);

  /// The current bookmarked event ids — merged across every relay revision
  /// (kind 10003 is replaceable; a single-revision read is often stale) plus
  /// the optimistic cache covering the propagation window after our own write.
  Future<Set<String>> fetchBookmarkedIds(String pubkey) =>
      social.fetchBookmarkedIds(pubkey);

  // ── Studio: tiers + goals ───────────────────────────────────────────

  /// Publish (or replace) a subscription tier (kind 37001).
  NostrEvent createTier(List<List<String>> tags, {String content = ''}) =>
      social.createTier(tags, content: content);

  /// Publish a zap goal (NIP-75, kind 9041).
  NostrEvent createGoal(List<List<String>> tags, {String content = ''}) =>
      social.createGoal(tags, content: content);

  /// Announce a goal as a kind-1 note with a `goal` tag — makes it fundable
  /// by clients that have never heard of NIP-75.
  NostrEvent announceGoal({
    required String goalId,
    String? relayHint,
    required String content,
  }) =>
      social.announceGoal(goalId: goalId, relayHint: relayHint, content: content);

  /// NIP-04 encrypted DM (kind 4).
  NostrEvent createEncryptedDm(String peerPubkey, String plaintext) =>
      dms.createEncryptedDm(peerPubkey, plaintext);

  /// NIP-17 gift-wrapped DM (kind 1059) — modern, metadata-private.
  /// Most current clients (Amethyst, 0xchat, Damus) send DMs this way.
  List<NostrEvent> createNip17Dm(
    String peerPubkey,
    String plaintext, {
    String? replyToId,
    String? subject,
  }) =>
      dms.createNip17Dm(
        peerPubkey,
        plaintext,
        replyToId: replyToId,
        subject: subject,
      );

  /// NIP-17 reaction on a chat message (emoji inside encrypted chats).
  List<NostrEvent> createNip17Reaction(
    String peerPubkey, {
    required String messageId,
    String emoji = '+',
  }) =>
      dms.createNip17Reaction(peerPubkey, messageId: messageId, emoji: emoji);

  /// NIP-17 file message (share a file/image in an encrypted chat).
  List<NostrEvent> createNip17FileMessage(
    String peerPubkey, {
    required String url,
    String? mimeType,
    String? alt,
    String? blurhash,
  }) =>
      dms.createNip17FileMessage(
        peerPubkey,
        url: url,
        mimeType: mimeType,
        alt: alt,
        blurhash: blurhash,
      );

  /// NIP-17 group chat room message (one wrap per member + self copy).
  List<NostrEvent> createNip17GroupMessage(
    List<String> memberPubkeys,
    String plaintext, {
    String? subject,
    String? replyToId,
  }) =>
      dms.createNip17GroupMessage(
        memberPubkeys,
        plaintext,
        subject: subject,
        replyToId: replyToId,
      );

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
