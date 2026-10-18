import 'dart:async';
import 'dart:convert';
import '../models/nostr_models.dart';
import 'auth_service.dart';
import 'relay_pool.dart';

/// Central Nostr service — combines relay pool, auth, and all Nostr operations.
class NostrService {
  final RelayPool relayPool;
  final AuthService authService;
  AuthState _auth = const AuthState();
  bool _initialized = false;

  NostrService({List<String>? relays})
      : relayPool = RelayPool(relays: relays),
        authService = AuthService() {
    relayPool.authHandler = _handleRelayAuth;
  }

  AuthState get auth => _auth;
  bool get isLoggedIn => _auth.isLoggedIn;
  bool get canSign => _auth.isLoggedIn && !_auth.isReadOnly && _auth.privateKey != null;
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

  NostrEvent createReply(String content, String replyToId, String replyToPubkey, {String? rootId}) {
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
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 6,
      content: jsonEncode(event.toJson()),
      tags: [
        ['e', event.id],
        ['p', event.pubkey],
        ['client', 'nostrfeed'],
      ],
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

  NostrEvent updateProfile(NostrProfile profile) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 0,
      content: jsonEncode(profile.toJson()),
      tags: [['client', 'nostrfeed']],
    );
  }

  NostrEvent updateFollows(List<String> pubkeys) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 3,
      content: '',
      tags: pubkeys.map((pk) => ['p', pk]).toList(),
    );
  }

  NostrEvent createBookmark(List<String> eventIds, List<String> addresses) {
    _requireSigning();
    return authService.signEvent(
      privateKey: _auth.privateKey!,
      kind: 10003,
      content: '',
      tags: [
        ...eventIds.map((id) => ['e', id]),
        ...addresses.map((a) => ['a', a]),
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

  // ── Queries ─────────────────────────────────────────────────────────

  Future<NostrProfile?> fetchProfile(String pubkey) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [0], authors: [pubkey], limit: 1),
    ], timeout: const Duration(seconds: 8));
    if (events.isEmpty) return null;
    try {
      return NostrProfile.fromJson(jsonDecode(events.first.content) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<List<NostrEvent>> fetchFeed({int limit = 50, int? since, int? until, List<String>? authors}) async {
    final filter = NostrFilter(kinds: [1], limit: limit, since: since, until: until, authors: authors);
    final events = await relayPool.query([filter], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  Future<List<NostrEvent>> fetchFollowingFeed(List<String> followedPubkeys, {int limit = 50, int? until}) async {
    if (followedPubkeys.isEmpty) return [];
    return fetchFeed(limit: limit, until: until, authors: followedPubkeys);
  }

  Future<List<NostrEvent>> fetchReplies(String eventId) async {
    return relayPool.query([
      NostrFilter(kinds: [1], tagFilters: {'e': [eventId]}, limit: 100),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchReactions(String eventId) async {
    return relayPool.query([
      NostrFilter(kinds: [7], tagFilters: {'e': [eventId]}, limit: 200),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchReposts(String eventId) async {
    return relayPool.query([
      NostrFilter(kinds: [6, 16], tagFilters: {'e': [eventId]}, limit: 200),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<String>> fetchFollows(String pubkey) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [3], authors: [pubkey], limit: 1),
    ], timeout: const Duration(seconds: 8));
    if (events.isEmpty) return [];
    return events.first.pubkeyRefs;
  }

  Future<List<String>> fetchFollowers(String pubkey) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [3], tagFilters: {'p': [pubkey]}, limit: 500),
    ], timeout: const Duration(seconds: 8));
    return events.map((e) => e.pubkey).toSet().toList();
  }

  Future<List<NostrEvent>> fetchNotifications(String pubkey, {int limit = 50}) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [1, 6, 7, 9735], tagFilters: {'p': [pubkey]}, limit: limit),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  Future<List<NostrEvent>> search(String query, {int limit = 50}) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [1], search: query, limit: limit),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  Future<List<NostrEvent>> searchUsers(String query, {int limit = 20}) async {
    return relayPool.query([
      NostrFilter(kinds: [0], search: query, limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchBookmarks(String pubkey) async {
    return relayPool.query([
      NostrFilter(kinds: [10003], authors: [pubkey], limit: 1),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchDMs(String pubkey, {int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [4, 1059], authors: [pubkey], limit: limit),
      NostrFilter(kinds: [4, 1059], tagFilters: {'p': [pubkey]}, limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchHashtagFeed(String tag, {int limit = 50}) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [1], tagFilters: {'t': [tag.toLowerCase()]}, limit: limit),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  Future<List<NostrEvent>> fetchCommunities({int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [34550], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchArticles({int limit = 50}) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [30023], limit: limit),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  Future<List<NostrEvent>> fetchTrending({int limit = 50}) async {
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final events = await relayPool.query([
      NostrFilter(kinds: [1], since: now - 86400, limit: limit * 3),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events.take(limit).toList();
  }

  Future<List<NostrEvent>> fetchZapReceipts(String targetId, {bool isEvent = true}) async {
    return relayPool.query([
      NostrFilter(
        kinds: [9735],
        tagFilters: isEvent ? {'e': [targetId]} : {'p': [targetId]},
        limit: 100,
      ),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchLists(String pubkey) async {
    return relayPool.query([
      NostrFilter(kinds: [30001, 30003, 10003], authors: [pubkey], limit: 20),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchCalendarEvents({int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [31922, 31923], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchGroups({int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [39000, 39001, 39002], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchMarketListings({int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [30402], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchLiveStreams({int limit = 20}) async {
    return relayPool.query([
      NostrFilter(kinds: [30311], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }
}
