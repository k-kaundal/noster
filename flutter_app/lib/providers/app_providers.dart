import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/nostr_models.dart';
import '../services/auth_service.dart';
import '../services/nostr_service.dart';
import '../services/relay_pool.dart';
import '../config/env.dart';

/// Nostr service singleton.
final nostrServiceProvider = Provider<NostrService>((ref) => NostrService());

/// Helper: ensure service is initialized before querying.
Future<NostrService> _initNostr(Ref ref) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr;
}

/// Auth state
final authStateProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.read(nostrServiceProvider));
});

class AuthNotifier extends StateNotifier<AuthState> {
  final NostrService _nostr;

  AuthNotifier(this._nostr) : super(const AuthState()) {
    _init();
  }

  Future<void> _init() async {
    try {
      state = await _nostr.authService.getStoredAuth();
    } catch (_) {}
    if (state.isLoggedIn) _loadProfile();
  }

  Future<void> _loadProfile() async {
    if (state.pubkey != null) {
      final profile = await _nostr.fetchProfile(state.pubkey!);
      state = state.copyWith(profile: profile);
    }
  }

  Future<void> loginWithNsec(String nsec) async {
    state = await _nostr.authService.loginWithNsec(nsec);
    await _nostr.setAuth(state);
    _loadProfile();
  }

  Future<void> loginWithHexKey(String hexKey) async {
    state = await _nostr.authService.loginWithHexKey(hexKey);
    await _nostr.setAuth(state);
    _loadProfile();
  }

  Future<void> loginReadOnly(String npub) async {
    state = await _nostr.authService.loginReadOnly(npub);
    await _nostr.setAuth(state);
    _loadProfile();
  }

  Future<void> generateKeys() async {
    state = await _nostr.authService.generateKeys();
    await _nostr.setAuth(state);
    _loadProfile();
  }

  Future<void> logout() async {
    await _nostr.authService.logout();
    await _nostr.setAuth(const AuthState());
    state = const AuthState();
  }

  Future<void> updateProfile(NostrProfile profile) async {
    if (!state.isLoggedIn || state.privateKey == null) return;
    final event = _nostr.updateProfile(profile);
    _nostr.publish(event);
    state = state.copyWith(profile: profile);
  }

  Future<void> toggleFollow(String targetPubkey) async {
    if (!state.isLoggedIn || state.privateKey == null) return;
    final currentFollows = await _nostr.fetchFollows(state.pubkey!);
    final isFollowing = currentFollows.contains(targetPubkey);
    final newFollows = isFollowing
        ? currentFollows.where((pk) => pk != targetPubkey).toList()
        : [...currentFollows, targetPubkey];
    final event = _nostr.updateFollows(newFollows);
    _nostr.publish(event);
  }
}

/// Relay connection status
final relayStatusProvider = StateProvider<Map<String, RelayState>>((ref) => {});

/// Feed events (global)
final feedProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchFeed(limit: 100);
});

/// Feed events (following)
final followingFeedProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  final follows = await nostr.fetchFollows(auth.pubkey!);
  return nostr.fetchFollowingFeed(follows);
});

/// Trending events
final trendingProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchTrending();
});

/// User follows
final followsProvider = FutureProvider<List<String>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchFollows(auth.pubkey!);
});

/// Followers count
final followersProvider = FutureProvider.family<int, String>((ref, pubkey) async {
  final nostr = await _initNostr(ref);
  final followers = await nostr.fetchFollowers(pubkey);
  return followers.length;
});

/// Notifications
final notificationsProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchNotifications(auth.pubkey!);
});

/// Profile fetcher for any pubkey
final profileProvider = FutureProvider.family<NostrProfile?, String>((ref, pubkey) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchProfile(pubkey);
});

/// User posts
final userPostsProvider = FutureProvider.family<List<NostrEvent>, String>((ref, pubkey) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchFeed(limit: 50, authors: [pubkey]);
});

/// Search results
final searchProvider = FutureProvider.family<List<NostrEvent>, String>((ref, query) async {
  if (query.isEmpty) return [];
  final nostr = await _initNostr(ref);
  return nostr.search(query);
});

/// Search users
final userSearchProvider = FutureProvider.family<List<NostrEvent>, String>((ref, query) async {
  if (query.isEmpty) return [];
  final nostr = await _initNostr(ref);
  return nostr.searchUsers(query);
});

/// Hashtag feed
final hashtagFeedProvider = FutureProvider.family<List<NostrEvent>, String>((ref, tag) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchHashtagFeed(tag);
});

/// Replies for an event
final repliesProvider = FutureProvider.family<List<NostrEvent>, String>((ref, eventId) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchReplies(eventId);
});

/// Reactions for an event
final reactionsProvider = FutureProvider.family<List<NostrEvent>, String>((ref, eventId) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchReactions(eventId);
});

/// Reposts for an event
final repostsProvider = FutureProvider.family<List<NostrEvent>, String>((ref, eventId) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchReposts(eventId);
});

/// Zap receipts
final zapReceiptsProvider = FutureProvider.family<List<NostrEvent>, String>((ref, targetId) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchZapReceipts(targetId);
});

/// Communities
final communitiesProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchCommunities();
});

/// Articles
final articlesProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchArticles();
});

/// Bookmarks
final bookmarksProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchBookmarks(auth.pubkey!);
});

/// DMs
final dmsProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchDMs(auth.pubkey!);
});

/// Lists
final listsProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchLists(auth.pubkey!);
});

/// Calendar events
final calendarProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchCalendarEvents();
});

/// Groups
final groupsProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchGroups();
});

/// Market listings
final marketProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchMarketListings();
});

/// Live streams
final liveStreamsProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchLiveStreams();
});

/// Theme mode
final themeModeProvider = StateProvider<ThemeMode>((ref) => ThemeMode.system);

/// Selected relay
final selectedRelayProvider = StateProvider<String>((ref) => Env.defaultRelays.first);
