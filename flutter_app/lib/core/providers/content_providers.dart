import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';
import 'package:nostrfeed_mobile/core/providers/auth_providers.dart';
import 'package:nostrfeed_mobile/core/providers/nostr_service_providers.dart';
import 'package:nostrfeed_mobile/features/compose/data/upload_service.dart';
import 'package:nostrfeed_mobile/features/explore/domain/feed_ranking.dart';

/// Relay connection status
final relayStatusProvider = StateProvider<Map<String, RelayState>>((ref) => {});

/// A monotonic counter bumped whenever engagement events land in the store.
/// PostCards watch this to recompute their counts from the local SQL index —
/// row-scoped rebuilds instead of every card rebuilding on every provider
/// fan-out (the other half of the feed-jank fix).
///
/// ADR-0005 P3: lives in core (was in feed_notifier) because the ingest
/// pipeline bumps it from the bus — the pipeline is core, not feed feature.
final engagementVersionProvider = StateProvider<int>((ref) => 0);

/// Local engagement counts for one event, straight from the SQLite index.
/// Replaces the per-event `engagementProvider` relay query in the feed.
///
/// autoDispose is LOAD-BEARING: every PostCard watches its own family entry,
/// and every entry re-fires on each `engagementVersionProvider` tick (every
/// ~500 ms during live activity). Without disposal, entries accumulate for
/// every post ever seen this session and each tick re-queries SQL for ALL
/// of them — scrolled-away posts included. Disposed entries re-query cheaply
/// on scroll-back.
final localEngagementProvider = FutureProvider.family
    .autoDispose<EventCounts, String>((ref, eventId) async {
  // Recompute whenever a new engagement batch lands.
  ref.watch(engagementVersionProvider);
  final map = await EventStore.instance.engagementFor([eventId]);
  return map[eventId] ?? EventCounts();
});

/// Feed events live in `globalFeedProvider` / `followingFeedNotifierProvider`
/// (SQLite-backed Notifiers) — there is NO plain feed FutureProvider here.
/// One used to exist and diverged from the Notifier's store-backed state;
/// it was deleted. Add new feed surfaces on the Notifiers, never a second
/// one-shot provider.

/// Trending events — parameterized by time window in hours.
/// Uses engagement-score ranking (Hacker News style decay).
///
/// STREAM: local paints instantly, relay is the discovery truth.
///
/// Trending is a DISCOVERY surface — the local store only knows posts from
/// feeds you've already scrolled, so a local-only answer is the same list
/// on every chip (the "1h/24h/7d all show the same data" bug from the
/// first local-first cut). So:
///   1. The LOCAL engagement-window query (ADR-0005 L5) yields FIRST when
///      non-empty — instant paint, and the whole answer when offline.
///   2. The relay fetch per window yields SECOND when it succeeds — real
///      discovery of what you haven't seen, and each time chip gets its own
///      network window (so 1h ≠ 24h ≠ 7d, as it should).
final trendingProvider = StreamProvider.family
    .autoDispose<List<NostrEvent>, int>((ref, hours) async* {
  // 1. Instant local paint (empty on fresh installs — skipped silently).
  final local = await _localTrending(hours);
  var painted = false;
  if (local.isNotEmpty) {
    painted = true;
    yield local;
  }

  // 2. Relay truth — the discovery path. Each window is a real network
  // query; the local paint stays if the relay is unreachable/thin.
  try {
    final nostr = await initNostr(ref);
    final events = await nostr.fetchTrending(limit: 50, hours: hours);
    if (events.isNotEmpty) {
      // Warm the store so future local windows + engagement counts benefit.
      unawaited(EventStore.instance.ingest(events));
      yield events;
      return;
    }
  } catch (_) {
    // Offline / dead relays — the local paint (if any) stands.
  }

  // 3. Nothing local AND nothing from relays: emit a definitive empty so
  // the UI shows EmptyState instead of spinning forever.
  if (!painted) yield const [];
});

/// The ADR-0005 local trending query: engagement-window candidates from the
/// store, ranked by the anti-manipulation engine. This is the instant paint
/// + offline fallback — "trending in the last N hours" as a pure WHERE
/// clause over the engagement index.
Future<List<NostrEvent>> _localTrending(int hours) async {
  final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
  final since = nowSeconds - (hours * 3600);

  final candidates = await EventStore.instance.trendingCandidates(
    sinceSeconds: since,
    candidateLimit: 150,
  );
  if (candidates.isEmpty) return const [];

  final ids = candidates.map((c) => c.eventId).toList();
  final events = await EventStore.instance.eventsById(ids);
  if (events.isEmpty) return const [];

  final engagementMap = <String, EventEngagement>{
    for (final c in candidates)
      c.eventId: EventEngagement(
        replies: c.replies,
        reactions: c.reactions,
        reposts: c.reposts,
        zaps: c.zaps,
        uniqueEngagers: c.uniqueEngagers,
      ),
  };
  return FeedRanking.rank(
    events,
    engagementMap: engagementMap,
    nowSeconds: nowSeconds,
    scoreFn: (eng, event, authorCount) => FeedRanking.trendingScore(
      engagement: eng,
      createdAt: event.createdAt,
      nowSeconds: nowSeconds,
      authorPostCountInWindow: authorCount,
    ),
  );
}

/// User's like/repost state for ONE event.
/// Returns ({likes: {eventId: bool}, reposts: {eventId: bool}}).
///
/// The family key is a single event id String — NEVER a `List<String>`:
/// Dart Lists have identity equality, so every `[id]` literal was a NEW
/// family key (cache entries multiplied, and `ref.invalidate` silently
/// targeted an instance nobody watched). Call sites pass one id.
final userInteractionsProvider = FutureProvider.family
    .autoDispose<
      ({Map<String, bool> likes, Map<String, bool> reposts}),
      String
    >((ref, eventId) async {
      final nostr = await initNostr(ref);
      final auth = ref.watch(authStateProvider);
      if (!auth.isLoggedIn || auth.pubkey == null) {
        return (likes: const <String, bool>{}, reposts: const <String, bool>{});
      }
      return nostr.fetchUserInteractions([eventId], auth.pubkey!);
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
final repliesProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((
  ref,
  eventId,
) async {
  // Store-first: replies we already have render INSTANTLY (including the
  // user's just-published reply, which is ingested optimistically at post
  // time), then the relay fetch backfills and merges — the thread never
  // sits on a spinner when we have local data, and a fresh reply never
  // waits on a relay round-trip (the "reply posted but invisible" bug that
  // caused double-posting).
  final cached = await EventStore.instance.repliesFor(eventId);
  try {
    final nostr = await initNostr(ref);
    final fresh = await nostr.fetchReplies(eventId);
    if (fresh.isNotEmpty) {
      await EventStore.instance.ingest(fresh);
      final seen = cached.map((e) => e.id).toSet();
      final merged = [
        ...cached,
        ...fresh.where((e) => !seen.contains(e.id)),
      ]..sort((a, b) => a.createdAt.compareTo(b.createdAt));
      return merged;
    }
  } catch (_) {
    // Offline / relay hiccup — the cached replies are still shown.
  }
  return cached;
});

/// NIP-22 comments for an addressable event (article, etc.)
/// Key is the `kind:pubkey:d` coordinate.
final articleCommentsProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>(
  (ref, coordinate) async {
    final nostr = await initNostr(ref);
    return nostr.fetchComments(coordinate, isAddressable: true);
  },
);

/// Engagement for an addressable event (article, etc.)
/// Key is the `kind:pubkey:d` coordinate.
final addressableEngagementProvider = FutureProvider.family
    .autoDispose<EventEngagement, String>((ref, coordinate) async {
      final nostr = await initNostr(ref);
      return nostr.fetchEngagementForAddress(coordinate);
    });

/// Reactions for an event
final reactionsProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((
  ref,
  eventId,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchReactions(eventId);
});

/// Reposts for an event
final repostsProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((
  ref,
  eventId,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchReposts(eventId);
});

/// Zap receipts
final zapReceiptsProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((
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
final articlesProvider = FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final nostr = await initNostr(ref);
  return nostr.fetchArticles();
});

/// Bookmarks (resolved events from the user's bookmark list)
final bookmarksProvider = FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
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

/// Bookmarked event IDs (for checking if a post is bookmarked).
///
/// keepAlive on purpose: EVERY PostCard in the feed watches this (the
/// bookmark button state), so disposing between screens would re-fetch the
/// id set on every tab switch — the same keepAlive trade-off as
/// profileProvider.
final bookmarkedIdsProvider = FutureProvider<Set<String>>((ref) async {
  ref.keepAlive();
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
final videosProvider = FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final nostr = await initNostr(ref);
  return nostr.fetchVideos();
});

/// Trending hashtags
final trendingHashtagsProvider = FutureProvider.autoDispose<List<HashtagStat>>((ref) async {
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
