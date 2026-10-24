import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';
import 'package:nostrfeed_mobile/core/providers/auth_providers.dart';
import 'package:nostrfeed_mobile/core/providers/nostr_service_providers.dart';
import 'package:nostrfeed_mobile/features/compose/data/upload_service.dart';

/// Relay connection status
final relayStatusProvider = StateProvider<Map<String, RelayState>>((ref) => {});

/// Feed events (global)
final feedProvider = FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final nostr = await initNostr(ref);
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

/// Trending events — parameterized by time window in hours.
/// Uses engagement-score ranking (Hacker News style decay).
final trendingProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, int>((ref, hours) async {
      final nostr = await initNostr(ref);
      return nostr.fetchTrending(limit: 50, hours: hours);
    });

/// User's like/repost state for a list of event IDs.
/// Returns ({likes: {eventId: bool}, reposts: {eventId: bool}}).
final userInteractionsProvider = FutureProvider.family
    .autoDispose<
      ({Map<String, bool> likes, Map<String, bool> reposts}),
      List<String>
    >((ref, eventIds) async {
      final nostr = await initNostr(ref);
      final auth = ref.watch(authStateProvider);
      if (!auth.isLoggedIn || auth.pubkey == null || eventIds.isEmpty) {
        return (likes: const <String, bool>{}, reposts: const <String, bool>{});
      }
      return nostr.fetchUserInteractions(eventIds, auth.pubkey!);
    });

/// Notifications
final notificationsProvider = FutureProvider.autoDispose<List<NostrEvent>>((
  ref,
) async {
  final nostr = await initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchNotifications(auth.pubkey!);
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
      final nostr = await initNostr(ref);

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
      final nostr = await initNostr(ref);
      return nostr.searchUsers(query);
    });

/// Hashtag feed
final hashtagFeedProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((ref, tag) async {
      final nostr = await initNostr(ref);
      return nostr.fetchHashtagFeed(tag);
    });

/// Replies for an event
final repliesProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  eventId,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchReplies(eventId);
});

/// NIP-22 comments for an addressable event (article, etc.)
/// Key is the `kind:pubkey:d` coordinate.
final articleCommentsProvider = FutureProvider.family<List<NostrEvent>, String>(
  (ref, coordinate) async {
    final nostr = await initNostr(ref);
    return nostr.fetchComments(coordinate, isAddressable: true);
  },
);

/// Engagement for an addressable event (article, etc.)
/// Key is the `kind:pubkey:d` coordinate.
final addressableEngagementProvider =
    FutureProvider.family<EventEngagement, String>((ref, coordinate) async {
      final nostr = await initNostr(ref);
      return nostr.fetchEngagementForAddress(coordinate);
    });

/// Reactions for an event
final reactionsProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  eventId,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchReactions(eventId);
});

/// Reposts for an event
final repostsProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  eventId,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchReposts(eventId);
});

/// Zap receipts
final zapReceiptsProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  targetId,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchZapReceipts(targetId);
});

/// Communities
final communitiesProvider = FutureProvider.autoDispose<List<NostrEvent>>((
  ref,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchCommunities();
});

/// Articles
final articlesProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await initNostr(ref);
  return nostr.fetchArticles();
});

/// Bookmarks (resolved events from the user's bookmark list)
final bookmarksProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await initNostr(ref);
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
  final nostr = await initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return {};
  return nostr.fetchBookmarkedIds(auth.pubkey!);
});

/// DMs
final dmsProvider = FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final nostr = await initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchDMs(auth.pubkey!, limit: 200);
});

/// Lists
final listsProvider = FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final nostr = await initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchLists(auth.pubkey!);
});

/// Calendar events
final calendarProvider = FutureProvider.autoDispose<List<NostrEvent>>((
  ref,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchCalendarEvents();
});

/// Market listings
final marketProvider = FutureProvider.autoDispose<List<NostrEvent>>((
  ref,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchMarketListings();
});

/// Live streams
final liveStreamsProvider = FutureProvider.autoDispose<List<NostrEvent>>((
  ref,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchLiveStreams();
});

/// Videos / reels
final videosProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await initNostr(ref);
  return nostr.fetchVideos();
});

/// Trending hashtags
final trendingHashtagsProvider = FutureProvider<List<HashtagStat>>((ref) async {
  final nostr = await initNostr(ref);
  return nostr.fetchTrendingHashtags();
});

/// Engagement stats for an event
final engagementProvider = FutureProvider.family
    .autoDispose<EventEngagement, String>((ref, eventId) async {
      final nostr = await initNostr(ref);
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
