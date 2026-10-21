import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';
import 'package:nostrfeed_mobile/features/compose/services/upload_service.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';

/// Nostr service singleton.
final nostrServiceProvider = Provider<NostrService>((ref) => NostrService());

/// Helper: ensure service is initialized before querying.
Future<NostrService> _initNostr(Ref ref) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr;
}

/// Auth state
final authStateProvider = NotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);

class AuthNotifier extends Notifier<AuthState> {
  late final NostrService _nostr;

  /// The initial state [build] returned. If [state] has moved on from this
  /// by the time the async storage read resolves, an explicit auth action
  /// happened and the restore must not overwrite it (race guard).
  static const _initial = AuthState();

  @override
  AuthState build() {
    _nostr = ref.read(nostrServiceProvider);
    _init();
    return _initial;
  }

  Future<void> _init() async {
    AuthState stored;
    try {
      stored = await _nostr.authService.getStoredAuth();
    } catch (_) {
      stored = const AuthState();
    }
    // State was changed explicitly (login/logout/test) while the storage
    // read was in flight — the newer state wins, drop the stale restore.
    if (state != _initial) return;
    state = stored;
    if (state.isLoggedIn) _loadProfile();
  }

  Future<void> _loadProfile() async {
    if (state.pubkey == null) return;
    // Capture what we already have (from secure storage / fresh update) —
    // fetchProfile returns the NEWEST version it can find, but when relays
    // lag it may return the locally-cached fresh one, and when relays are
    // unreachable it returns the cache (possibly stale or null).
    final relayProfile = await _nostr.fetchProfile(state.pubkey!);
    // Never DOWNGRADE: if the relay returned nothing, keep what we have.
    if (relayProfile == null) return;
    state = state.copyWith(profile: relayProfile);
    // Persist so the next cold start shows this profile immediately.
    await _nostr.authService.saveStoredProfile(relayProfile);
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

  /// Updates the in-memory profile on the auth state without publishing.
  /// Used after a kind-0 has already been published (e.g. by the identity /
  /// lightning-address flows) so the local UI reflects it immediately.
  void updateLocalProfile(NostrProfile profile) {
    state = state.copyWith(profile: profile);
  }

  Future<void> updateProfile(NostrProfile profile) async {
    if (!state.isLoggedIn || state.privateKey == null) return;
    final event = _nostr.updateProfile(profile);
    _nostr.publish(event);

    // Update the shared profile cache with the locally-known fresh data.
    // Relays may take a few seconds to propagate the new kind-0, and any
    // fetchProfile during that window will get stale data — this cache
    // ensures the UI sees the update immediately.
    if (state.pubkey != null) {
      _nostr.profileCache[state.pubkey!] = (
        profile: profile,
        createdAt: event.createdAt,
        fetchedAt: event.createdAt,
      );
    }

    state = state.copyWith(profile: profile);

    // Persist locally so the profile survives app restarts — otherwise the
    // next cold start shows an empty profile until relays respond.
    await _nostr.authService.saveStoredProfile(profile);

    // Invalidate all profile-dependent providers so every screen that
    // displays this user's info rebuilds with the latest data.
    if (state.pubkey != null) {
      ref.invalidate(profileProvider(state.pubkey!));
    }
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

    // Invalidate follow-dependent providers so counts/lists update everywhere.
    ref.invalidate(followsProvider);
    ref.invalidate(followersProvider);
    ref.invalidate(followingFeedProvider);
  }
}

/// Relay connection status
final relayStatusProvider = StateProvider<Map<String, RelayState>>((ref) => {});

/// Feed events (global)
final feedProvider = FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);

  // Main feed: global posts.
  final posts = await nostr.fetchFeed(limit: 100);

  // Merge in posts from communities the user JOINED (NIP-72) — so their
  // community content shows up in the home feed too.
  if (auth.isLoggedIn && auth.pubkey != null) {
    try {
      final joinedEvents = await nostr.relayPool.query([
        NostrFilter(kinds: [10004], authors: [auth.pubkey!], limit: 3),
      ], timeout: const Duration(seconds: 4));
      final coordinates = <String>{};
      for (final e in joinedEvents) {
        for (final tag in e.tags) {
          if (tag.isNotEmpty && tag[0] == 'a' && tag.length > 1) {
            coordinates.add(tag[1]);
          }
        }
      }
      if (coordinates.isNotEmpty) {
        final communityPosts = await nostr.relayPool.query([
          NostrFilter(
            kinds: [1, 1111],
            tagFilters: {'a': coordinates.toList()},
            limit: 40,
          ),
        ], timeout: const Duration(seconds: 5));
        final seen = posts.map((e) => e.id).toSet();
        for (final cp in communityPosts) {
          if (seen.add(cp.id)) posts.add(cp);
        }
        posts.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      }
    } catch (_) {
      // Community merge is best-effort — the main feed already loaded.
    }
  }

  return posts;
});

/// Feed events (following)
final followingFeedProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  final follows = await nostr.fetchFollows(auth.pubkey!);
  return nostr.fetchFollowingFeed(follows);
});

/// Trending events — parameterized by time window in hours.
/// Uses engagement-score ranking (Hacker News style decay).
final trendingProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, int>((ref, hours) async {
      final nostr = await _initNostr(ref);
      return nostr.fetchTrending(limit: 50, hours: hours);
    });

/// User's like/repost state for a list of event IDs.
/// Returns ({likes: {eventId: bool}, reposts: {eventId: bool}}).
final userInteractionsProvider = FutureProvider.family
    .autoDispose<
      ({Map<String, bool> likes, Map<String, bool> reposts}),
      List<String>
    >((ref, eventIds) async {
      final nostr = await _initNostr(ref);
      final auth = ref.watch(authStateProvider);
      if (!auth.isLoggedIn || auth.pubkey == null || eventIds.isEmpty) {
        return (likes: const <String, bool>{}, reposts: const <String, bool>{});
      }
      return nostr.fetchUserInteractions(eventIds, auth.pubkey!);
    });

/// User follows
final followsProvider = FutureProvider.autoDispose<List<String>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchFollows(auth.pubkey!);
});

/// Followers count
final followersProvider = FutureProvider.family.autoDispose<int, String>((
  ref,
  pubkey,
) async {
  final nostr = await _initNostr(ref);
  final followers = await nostr.fetchFollowers(pubkey);
  return followers.length;
});

/// Notifications
final notificationsProvider = FutureProvider.autoDispose<List<NostrEvent>>((
  ref,
) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchNotifications(auth.pubkey!);
});

/// Profile fetcher for any pubkey.
///
/// NOT autoDispose: profiles are the hottest data in the app (every post
/// card, avatar, mention watches one) and `NostrService.profileCache`
/// already TTL-caches the network side. Disposing the provider on every
/// scroll-away re-fetched profiles mid-scroll, which is what made avatars
/// flicker. keepAlive + the 10-min cache = instant, stable profile rows.
final profileProvider = FutureProvider.family<NostrProfile?, String>((
  ref,
  pubkey,
) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchProfile(pubkey);
});

/// User posts.
///
/// keepAlive (NOT autoDispose): a profile's posts are re-read on every tab
/// switch (Posts / Replies / Articles / Media all filter the same list), so
/// disposing between tabs re-fetched the whole list per tab — the profile
/// tab flicker. The list is small (50) and profile screens are short-lived;
/// keeping it alive while the profile is open is the right trade.
final userPostsProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  pubkey,
) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchFeed(limit: 50, authors: [pubkey]);
});

/// Search results
///
/// Smart routing:
///  - `#tag` or `tag` prefixed with '#' → hashtag tag-filter query
///  - npub/nprofile → profile fetch by pubkey (future enhancement)
///  - anything else → NIP-50 full-text search
final searchProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((ref, query) async {
      if (query.isEmpty) return [];
      final nostr = await _initNostr(ref);

      // Hashtag search: "#bitcoin" → filter by 't' tag
      if (query.startsWith('#') && query.length > 1) {
        final tag = query.substring(1).trim();
        if (tag.isEmpty) return [];
        return nostr.fetchHashtagFeed(tag, limit: 50);
      }

      return nostr.search(query);
    });

/// Search users
///
/// Combines NIP-50 search (if relay supports it) with local filtering on
/// name/display_name so partial matches work even on relays without search.
final userSearchProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((ref, query) async {
      if (query.isEmpty) return [];
      final nostr = await _initNostr(ref);
      return nostr.searchUsers(query);
    });

/// Hashtag feed
final hashtagFeedProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((ref, tag) async {
      final nostr = await _initNostr(ref);
      return nostr.fetchHashtagFeed(tag);
    });

/// Replies for an event
final repliesProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  eventId,
) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchReplies(eventId);
});

/// NIP-22 comments for an addressable event (article, etc.)
/// Key is the `kind:pubkey:d` coordinate.
final articleCommentsProvider = FutureProvider.family<List<NostrEvent>, String>(
  (ref, coordinate) async {
    final nostr = await _initNostr(ref);
    return nostr.fetchComments(coordinate, isAddressable: true);
  },
);

/// Engagement for an addressable event (article, etc.)
/// Key is the `kind:pubkey:d` coordinate.
final addressableEngagementProvider =
    FutureProvider.family<EventEngagement, String>((ref, coordinate) async {
      final nostr = await _initNostr(ref);
      return nostr.fetchEngagementForAddress(coordinate);
    });

/// Reactions for an event
final reactionsProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  eventId,
) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchReactions(eventId);
});

/// Reposts for an event
final repostsProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  eventId,
) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchReposts(eventId);
});

/// Zap receipts
final zapReceiptsProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  targetId,
) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchZapReceipts(targetId);
});

/// Communities
final communitiesProvider = FutureProvider.autoDispose<List<NostrEvent>>((
  ref,
) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchCommunities();
});

/// Articles
final articlesProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchArticles();
});

/// Bookmarks (resolved events from the user's bookmark list)
final bookmarksProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  // The merged id set (every relay revision + optimistic write), NOT
  // fetchBookmarks' single stale revision.
  final ids = await nostr.fetchBookmarkedIds(auth.pubkey!);
  if (ids.isEmpty) return [];
  // Fetch the bookmarked events
  final events = await nostr.relayPool.query([
    NostrFilter(ids: ids.toList(), limit: 100),
  ], timeout: const Duration(seconds: 8));
  events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return events;
});

/// Bookmarked event IDs (for checking if a post is bookmarked)
final bookmarkedIdsProvider = FutureProvider<Set<String>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return {};
  return nostr.fetchBookmarkedIds(auth.pubkey!);
});

/// DMs
final dmsProvider = FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchDMs(auth.pubkey!, limit: 200);
});

/// Lists
final listsProvider = FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchLists(auth.pubkey!);
});

/// Calendar events
final calendarProvider = FutureProvider.autoDispose<List<NostrEvent>>((
  ref,
) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchCalendarEvents();
});

/// Market listings
final marketProvider = FutureProvider.autoDispose<List<NostrEvent>>((
  ref,
) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchMarketListings();
});

/// Live streams
final liveStreamsProvider = FutureProvider.autoDispose<List<NostrEvent>>((
  ref,
) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchLiveStreams();
});

/// Videos / reels
final videosProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchVideos();
});

/// Trending hashtags
final trendingHashtagsProvider = FutureProvider<List<HashtagStat>>((ref) async {
  final nostr = await _initNostr(ref);
  return nostr.fetchTrendingHashtags();
});

/// Engagement stats for an event
final engagementProvider = FutureProvider.family
    .autoDispose<EventEngagement, String>((ref, eventId) async {
      final nostr = await _initNostr(ref);
      return nostr.fetchEngagement(eventId);
    });

/// Upload service for Blossom media uploads
final uploadServiceProvider = Provider<UploadService>((ref) {
  final nostrService = ref.read(nostrServiceProvider);
  return UploadService(nostrService.authService, nostrService);
});

/// Theme mode
final themeModeProvider = StateProvider<ThemeMode>((ref) => ThemeMode.system);

/// Selected relay
final selectedRelayProvider = StateProvider<String>(
  (ref) => Env.defaultRelays.first,
);
