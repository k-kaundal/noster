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
///
/// CACHED per window with a TTL (keepAlive): explore/trending are BROWSE
/// screens — autoDispose threw the whole list away on every tab switch and
/// re-ran TWO serial relay waterfalls on every visit (the "explore is slow"
/// complaint). keepAlive + TTL: re-entry is instant from cache; the relay
/// leg only re-runs after [_trendingRelayTtl] (pull-to-refresh invalidates).
final trendingProvider = StreamProvider.family<List<NostrEvent>, int>((
  ref,
  hours,
) async* {
  // 1. Instant local paint (empty on fresh installs — skipped silently).
  final local = await _localTrending(hours);
  var painted = false;
  if (local.isNotEmpty) {
    painted = true;
    yield local;
  }

  // 2. Relay truth — the discovery path, TTL-gated so re-entering the
  // screen doesn't re-run the waterfall back-to-back.
  final lastFetch = ref.read(_trendingRelayFetchedAtProvider)[hours] ?? 0;
  final nowMs = DateTime.now().millisecondsSinceEpoch;
  final stale = nowMs - lastFetch > _trendingRelayTtl.inMilliseconds;
  if (stale) {
    try {
      final nostr = await initNostr(ref);
      final events = await nostr.fetchTrending(limit: 50, hours: hours);
      ref
          .read(_trendingRelayFetchedAtProvider.notifier)
          .update((m) => {...m, hours: DateTime.now().millisecondsSinceEpoch});
      if (events.isNotEmpty) {
        // Warm the store so future local windows + engagement counts benefit.
        unawaited(EventStore.instance.ingest(events));
        yield events;
        return;
      }
    } catch (_) {
      // Offline / dead relays — the local paint (if any) stands.
    }
  }

  // 3. Nothing local AND nothing from relays: emit a definitive empty so
  // the UI shows EmptyState instead of spinning forever.
  if (!painted) yield const [];
});

/// Per-window timestamps of the last successful relay trending fetch (TTL
/// gate for [trendingProvider] — a browse-back inside the TTL is instant).
final _trendingRelayFetchedAtProvider = StateProvider<Map<int, int>>(
  (ref) => const {},
);

/// How long a relay trending result is trusted before re-fetching.
const _trendingRelayTtl = Duration(minutes: 5);

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
///
/// LOCAL-FIRST (the per-card relay-query jank fix): reads from the SQLite
/// engagement index — the page's engagement batch already ingested the
/// user's own kind 6/7/16, so this is a grouped SQL row, NOT a relay
/// round-trip per card. Re-runs on every engagement tick (like the counts).
/// Relay backfill only for events the local index hasn't seen yet (old
/// posts from before the pipeline).
final userInteractionsProvider = FutureProvider.family
    .autoDispose<
      ({Map<String, bool> likes, Map<String, bool> reposts}),
      String
    >((ref, eventId) async {
      // Recompute when engagement lands (same tick as the counts).
      ref.watch(engagementVersionProvider);
      final auth = ref.watch(authStateProvider);
      if (!auth.isLoggedIn || auth.pubkey == null) {
        return (likes: const <String, bool>{}, reposts: const <String, bool>{});
      }
      final map = await EventStore.instance.userInteractionsFor(auth.pubkey!, [
        eventId,
      ]);
      final row = map[eventId];
      if (row != null) {
        return (likes: {eventId: row.liked}, reposts: {eventId: row.reposted});
      }
      // No local row: fall back to a relay check (rare — pre-pipeline
      // events), so an old liked post still shows filled.
      try {
        final nostr = await initNostr(ref);
        return await nostr.fetchUserInteractions([eventId], auth.pubkey!);
      } catch (_) {
        return (likes: const <String, bool>{}, reposts: const <String, bool>{});
      }
    });

/// Notifications
///
/// keepAlive + TTL: was autoDispose relay-only, so opening the bell re-ran
/// the fetch on every visit. The TTL short-circuits NATURAL rebuilds;
/// `ref.invalidate` / `ref.refresh` forces a real refetch (pull-to-refresh).
final notificationsProvider =
    AsyncNotifierProvider<NotificationsNotifier, List<NostrEvent>>(
      NotificationsNotifier.new,
    );

class NotificationsNotifier extends AsyncNotifier<List<NostrEvent>> {
  int _fetchedAt = 0;

  @override
  Future<List<NostrEvent>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _browseTtl.inMilliseconds;
    final current = state.valueOrNull;
    // TTL gate: only short-circuits a NATURAL rebuild (screen re-entry). An
    // invalidate/refresh RESETS state → current is null → we always refetch.
    if (!stale && current != null && current.isNotEmpty) return current;

    final auth = ref.watch(authStateProvider);
    if (!auth.isLoggedIn || auth.pubkey == null) return current ?? [];
    final nostr = await initNostr(ref);
    final fresh = await nostr.fetchNotifications(auth.pubkey!);
    if (fresh.isNotEmpty) {
      unawaited(EventStore.instance.ingest(fresh));
      _fetchedAt = DateTime.now().millisecondsSinceEpoch;
    }
    return fresh.isNotEmpty ? fresh : (current ?? fresh);
  }
}

/// Shared TTL for browse-screen caches (notifications, articles, etc.).
const _browseTtl = Duration(minutes: 5);

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

/// Hashtag feed — STREAM (local paints instantly, relay backfills), with a
/// per-tag TTL so re-tapping a tag inside the TTL doesn't re-fetch.
///
/// Before: relay-only — offline/slow relays sat on a spinner, and the store
/// (which already indexes `t` tags, ADR-0007 v3) was never consulted. Now:
///   1. LOCAL tag query yields FIRST when non-empty — instant paint, the
///      whole answer offline (the in-app relay serving the hashtag screen).
///   2. The RELAY fetch yields SECOND when it returns MORE than the local
///      paint — real discovery of posts you haven't synced yet.
/// An EMPTY relay result is NOT TTL-cached (a quiet first fetch retries on
/// re-entry instead of sticking "No posts" for the TTL).
final hashtagFeedProvider = StreamProvider.family
    .autoDispose<List<NostrEvent>, String>((ref, tag) async* {
      final normalized = tag.toLowerCase();
      final filter = NostrFilter(
        kinds: const [1],
        tagFilters: {
          't': [normalized],
        },
        limit: 50,
      );

      // 1. Instant local paint (skipped silently when empty — fresh installs).
      final local = await EventStore.instance.queryByFilters([
        filter,
      ], defaultLimit: 50);
      var painted = false;
      if (local.isNotEmpty) {
        painted = true;
        yield local;
      }

      // 2. Relay backfill, TTL-gated per tag.
      final lastFetch =
          ref.read(_hashtagRelayFetchedAtProvider)[normalized] ?? 0;
      final stale =
          DateTime.now().millisecondsSinceEpoch - lastFetch >
          _browseTtl.inMilliseconds;
      if (stale) {
        try {
          final nostr = await initNostr(ref);
          final fresh = await nostr.fetchHashtagFeed(normalized, limit: 50);
          if (fresh.isNotEmpty) {
            ref
                .read(_hashtagRelayFetchedAtProvider.notifier)
                .update(
                  (m) => {
                    ...m,
                    normalized: DateTime.now().millisecondsSinceEpoch,
                  },
                );
            unawaited(EventStore.instance.ingest(fresh));
            // Merge local + remote (dedup by id, newest-first) so the backfill
            // ADDS to the local paint instead of replacing it with a thin page.
            final seen = local.map((e) => e.id).toSet();
            final merged = [
              ...local,
              ...fresh.where((e) => !seen.contains(e.id)),
            ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
            yield merged;
            return;
          }
        } catch (_) {
          // Offline / dead relays — the local paint (if any) stands.
        }
      }

      // 3. Nothing local AND nothing from relays: a definitive empty so the UI
      // shows EmptyState instead of spinning forever.
      if (!painted) yield const [];
    });

/// Per-tag timestamps of the last successful relay hashtag fetch (TTL gate).
final _hashtagRelayFetchedAtProvider = StateProvider<Map<String, int>>(
  (ref) => const {},
);

/// Replies for an event
final repliesProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((ref, eventId) async {
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
    .autoDispose<List<NostrEvent>, String>((ref, coordinate) async {
      final nostr = await initNostr(ref);
      return nostr.fetchComments(coordinate, isAddressable: true);
    });

/// Engagement for an addressable event (article, etc.)
/// Key is the `kind:pubkey:d` coordinate.
final addressableEngagementProvider = FutureProvider.family
    .autoDispose<EventEngagement, String>((ref, coordinate) async {
      final nostr = await initNostr(ref);
      return nostr.fetchEngagementForAddress(coordinate);
    });

/// Reactions for an event
final reactionsProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((ref, eventId) async {
      final nostr = await initNostr(ref);
      return nostr.fetchReactions(eventId);
    });

/// Reposts for an event
final repostsProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((ref, eventId) async {
      final nostr = await initNostr(ref);
      return nostr.fetchReposts(eventId);
    });

/// Zap receipts
final zapReceiptsProvider = FutureProvider.family
    .autoDispose<List<NostrEvent>, String>((ref, targetId) async {
      final nostr = await initNostr(ref);
      return nostr.fetchZapReceipts(targetId);
    });

/// Communities — keepAlive + TTL (browse screen, was autoDispose relay-only).
final communitiesProvider =
    AsyncNotifierProvider<CommunitiesNotifier, List<NostrEvent>>(
      CommunitiesNotifier.new,
    );

class CommunitiesNotifier extends AsyncNotifier<List<NostrEvent>> {
  int _fetchedAt = 0;
  @override
  Future<List<NostrEvent>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _browseTtl.inMilliseconds;
    final current = state.valueOrNull;
    if (!stale && current != null && current.isNotEmpty) return current;
    final nostr = await initNostr(ref);
    final fresh = await nostr.fetchCommunities();
    if (fresh.isNotEmpty) {
      unawaited(EventStore.instance.ingest(fresh));
      _fetchedAt = DateTime.now().millisecondsSinceEpoch;
    }
    return fresh.isNotEmpty ? fresh : (current ?? fresh);
  }
}

/// Articles — keepAlive + TTL + store-warm (was autoDispose relay-only:
/// the articles screen re-ran the fetch on every visit).
final articlesProvider =
    AsyncNotifierProvider<ArticlesNotifier, List<NostrEvent>>(
      ArticlesNotifier.new,
    );

class ArticlesNotifier extends AsyncNotifier<List<NostrEvent>> {
  int _fetchedAt = 0;
  @override
  Future<List<NostrEvent>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _browseTtl.inMilliseconds;
    final current = state.valueOrNull;
    if (!stale && current != null && current.isNotEmpty) return current;
    final nostr = await initNostr(ref);
    final fresh = await nostr.fetchArticles();
    if (fresh.isNotEmpty) {
      unawaited(EventStore.instance.ingest(fresh));
      _fetchedAt = DateTime.now().millisecondsSinceEpoch;
    }
    return fresh.isNotEmpty ? fresh : (current ?? fresh);
  }
}

/// Bookmarks (resolved events from the user's bookmark list) —
/// keepAlive + TTL, store-warm (was autoDispose relay-only).
final bookmarksProvider =
    AsyncNotifierProvider<BookmarksNotifier, List<NostrEvent>>(
      BookmarksNotifier.new,
    );

class BookmarksNotifier extends AsyncNotifier<List<NostrEvent>> {
  int _fetchedAt = 0;
  @override
  Future<List<NostrEvent>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _browseTtl.inMilliseconds;
    final current = state.valueOrNull;
    if (!stale && current != null && current.isNotEmpty) return current;

    final nostr = await initNostr(ref);
    final auth = ref.watch(authStateProvider);
    if (!auth.isLoggedIn || auth.pubkey == null) return current ?? [];
    // The merged id set (every relay revision + optimistic write), NOT
    // fetchBookmarks' single stale revision.
    final ids = await nostr.fetchBookmarkedIds(auth.pubkey!);
    if (ids.isEmpty) return [];
    // Fetch the bookmarked events
    final events = await nostr.relayPool.query([
      NostrFilter(ids: ids.toList(), limit: 100),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    if (events.isNotEmpty) {
      unawaited(EventStore.instance.ingest(events));
      _fetchedAt = DateTime.now().millisecondsSinceEpoch;
    }
    return events.isNotEmpty ? events : (current ?? events);
  }
}

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

/// DMs — keepAlive + TTL (was autoDispose relay-only: opening chat re-ran
/// the fetch AND the decrypt batch on every visit). The decrypt cost is
/// time-sliced in DmStore.prime; this stops the refetch half of the jank.
final dmsProvider = AsyncNotifierProvider<DmsNotifier, List<NostrEvent>>(
  DmsNotifier.new,
);

class DmsNotifier extends AsyncNotifier<List<NostrEvent>> {
  int _fetchedAt = 0;
  @override
  Future<List<NostrEvent>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _browseTtl.inMilliseconds;
    final current = state.valueOrNull;
    if (!stale && current != null && current.isNotEmpty) return current;
    final nostr = await initNostr(ref);
    final auth = ref.watch(authStateProvider);
    if (!auth.isLoggedIn || auth.pubkey == null) return current ?? [];
    final fresh = await nostr.fetchDMs(auth.pubkey!, limit: 200);
    if (fresh.isNotEmpty) {
      _fetchedAt = DateTime.now().millisecondsSinceEpoch;
    }
    return fresh.isNotEmpty ? fresh : (current ?? fresh);
  }
}

/// Lists — keepAlive + TTL (was autoDispose relay-only).
final listsProvider = AsyncNotifierProvider<ListsNotifier, List<NostrEvent>>(
  ListsNotifier.new,
);

class ListsNotifier extends AsyncNotifier<List<NostrEvent>> {
  int _fetchedAt = 0;
  @override
  Future<List<NostrEvent>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _browseTtl.inMilliseconds;
    final current = state.valueOrNull;
    if (!stale && current != null && current.isNotEmpty) return current;
    final nostr = await initNostr(ref);
    final auth = ref.watch(authStateProvider);
    if (!auth.isLoggedIn || auth.pubkey == null) return current ?? [];
    final fresh = await nostr.fetchLists(auth.pubkey!);
    if (fresh.isNotEmpty) {
      _fetchedAt = DateTime.now().millisecondsSinceEpoch;
    }
    return fresh.isNotEmpty ? fresh : (current ?? fresh);
  }
}

/// Calendar events — keepAlive + TTL (was autoDispose relay-only).
final calendarProvider =
    AsyncNotifierProvider<CalendarNotifier, List<NostrEvent>>(
      CalendarNotifier.new,
    );

class CalendarNotifier extends AsyncNotifier<List<NostrEvent>> {
  int _fetchedAt = 0;
  @override
  Future<List<NostrEvent>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _browseTtl.inMilliseconds;
    final current = state.valueOrNull;
    if (!stale && current != null && current.isNotEmpty) return current;
    final nostr = await initNostr(ref);
    final fresh = await nostr.fetchCalendarEvents();
    if (fresh.isNotEmpty) {
      unawaited(EventStore.instance.ingest(fresh));
      _fetchedAt = DateTime.now().millisecondsSinceEpoch;
    }
    return fresh.isNotEmpty ? fresh : (current ?? fresh);
  }
}

/// Market listings — keepAlive + TTL (was autoDispose relay-only).
final marketProvider = AsyncNotifierProvider<MarketNotifier, List<NostrEvent>>(
  MarketNotifier.new,
);

class MarketNotifier extends AsyncNotifier<List<NostrEvent>> {
  int _fetchedAt = 0;
  @override
  Future<List<NostrEvent>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _browseTtl.inMilliseconds;
    final current = state.valueOrNull;
    if (!stale && current != null && current.isNotEmpty) return current;
    final nostr = await initNostr(ref);
    final fresh = await nostr.fetchMarketListings();
    if (fresh.isNotEmpty) {
      unawaited(EventStore.instance.ingest(fresh));
      _fetchedAt = DateTime.now().millisecondsSinceEpoch;
    }
    return fresh.isNotEmpty ? fresh : (current ?? fresh);
  }
}

/// Live streams — keepAlive + short TTL (was autoDispose relay-only; live
/// data goes stale fast, so a shorter window than other browse screens).
final liveStreamsProvider =
    AsyncNotifierProvider<LiveStreamsNotifier, List<NostrEvent>>(
      LiveStreamsNotifier.new,
    );

class LiveStreamsNotifier extends AsyncNotifier<List<NostrEvent>> {
  int _fetchedAt = 0;
  static const _ttl = Duration(minutes: 1);
  @override
  Future<List<NostrEvent>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _ttl.inMilliseconds;
    final current = state.valueOrNull;
    if (!stale && current != null && current.isNotEmpty) return current;
    final nostr = await initNostr(ref);
    final fresh = await nostr.fetchLiveStreams();
    if (fresh.isNotEmpty) {
      unawaited(EventStore.instance.ingest(fresh));
      _fetchedAt = DateTime.now().millisecondsSinceEpoch;
    }
    return fresh.isNotEmpty ? fresh : (current ?? fresh);
  }
}

/// Videos / reels — keepAlive + TTL (was autoDispose relay-only: the reels
/// screen re-ran the fetch on every visit).
final videosProvider = AsyncNotifierProvider<VideosNotifier, List<NostrEvent>>(
  VideosNotifier.new,
);

class VideosNotifier extends AsyncNotifier<List<NostrEvent>> {
  int _fetchedAt = 0;
  @override
  Future<List<NostrEvent>> build() async {
    final stale =
        DateTime.now().millisecondsSinceEpoch - _fetchedAt >
        _browseTtl.inMilliseconds;
    final current = state.valueOrNull;
    if (!stale && current != null && current.isNotEmpty) return current;
    final nostr = await initNostr(ref);
    final fresh = await nostr.fetchVideos();
    if (fresh.isNotEmpty) {
      unawaited(EventStore.instance.ingest(fresh));
      _fetchedAt = DateTime.now().millisecondsSinceEpoch;
    }
    return fresh.isNotEmpty ? fresh : (current ?? fresh);
  }
}

/// Trending hashtags
///
/// keepAlive + TTL: the second explore waterfall (500 events → engagement
/// batch) re-ran on EVERY screen visit under autoDispose. Browse-back
/// inside the TTL is instant; pull-to-refresh invalidates.
///
/// EMPTY results are NOT TTL-cached: a quiet first fetch (slow relays on a
/// cold start) must retry on the next visit, not stick "No trending
/// hashtags right now" on screen for 10 minutes (the "hashtags not showing
/// in explore" bug).
final trendingHashtagsProvider = FutureProvider<List<HashtagStat>>((ref) async {
  final lastFetch = ref.read(_hashtagsFetchedAtProvider);
  final stale =
      DateTime.now().millisecondsSinceEpoch - lastFetch >
      _hashtagsTtl.inMilliseconds;
  final cached = ref.read(_hashtagsCacheProvider);
  if (!stale && cached.isNotEmpty) return cached;

  final nostr = await initNostr(ref);
  final fresh = await nostr.fetchTrendingHashtags();
  // Only cache + start the TTL clock when we actually have hashtags — an
  // empty fetch retries next time instead of sticking for the full TTL.
  if (fresh.isNotEmpty) {
    ref.read(_hashtagsCacheProvider.notifier).state = fresh;
    ref.read(_hashtagsFetchedAtProvider.notifier).state =
        DateTime.now().millisecondsSinceEpoch;
  }
  return fresh;
});

final _hashtagsCacheProvider = StateProvider<List<HashtagStat>>(
  (ref) => const [],
);
final _hashtagsFetchedAtProvider = StateProvider<int>((ref) => 0);
const _hashtagsTtl = Duration(minutes: 10);

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
