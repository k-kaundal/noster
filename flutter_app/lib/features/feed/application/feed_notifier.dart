import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/flood_detector.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/feed/application/feed_store.dart';

/// The shared flood/duplicate detector — one instance observes every feed
/// event as it arrives and judges near-duplicates, sprays, and rapid-fire.
/// Keeps the platform from drowning in "same post every few minutes" spam.
final floodDetectorProvider = Provider<FloodDetector>((ref) => FloodDetector());

/// One feed's state: the events, plus everything the UI needs to behave
/// like a grown-up social app rather than a relay demo.
class FeedState {
  /// Events, newest first. Present from the first frame (disk cache), so
  /// the feed never starts as a skeleton it has to flicker out of.
  final List<NostrEvent> events;

  /// A fetch is in flight (initial or refresh). The current events stay on
  /// screen behind it — "refreshing" is a state, not a skeleton.
  final bool isRefreshing;

  /// More pages exist beyond what is loaded.
  final bool hasMore;

  /// Loading the next page (appended at the bottom).
  final bool isLoadingMore;

  /// Genuinely new events arrived via the live subscription since the user
  /// last looked — drives the "N new posts" pill, never an auto-insert
  /// that would yank the scroll position.
  final int newCount;

  /// The last fetch failed; the cached/current events stay visible.
  final String? error;

  /// When the events last came from the network (vs the disk cache).
  final DateTime? lastSyncedAt;

  const FeedState({
    this.events = const [],
    this.isRefreshing = false,
    this.hasMore = true,
    this.isLoadingMore = false,
    this.newCount = 0,
    this.error,
    this.lastSyncedAt,
  });

  FeedState copyWith({
    List<NostrEvent>? events,
    bool? isRefreshing,
    bool? hasMore,
    bool? isLoadingMore,
    int? newCount,
    String? error,
    DateTime? lastSyncedAt,
    bool clearError = false,
  }) {
    return FeedState(
      events: events ?? this.events,
      isRefreshing: isRefreshing ?? this.isRefreshing,
      hasMore: hasMore ?? this.hasMore,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      newCount: newCount ?? this.newCount,
      error: clearError ? null : (error ?? this.error),
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
    );
  }
}

/// The feed pipeline, offline-first:
///
/// 1. **Build** → read the disk cache and show it immediately.
/// 2. **Refresh** → fetch the newest page from relays, merge it in silently
///    (events on screen stay put; no skeleton), persist back to disk.
/// 3. **Live** → a persistent subscription watches for new posts; they
///    count into `newCount` for the "N new posts" pill instead of jumping
///    the list under the user's thumb.
/// 4. **Pagination** → `loadMore()` walks the `until` cursor back, appending
///    older pages, so the feed scrolls forever.
class FeedNotifier extends Notifier<FeedState> {
  final FeedStore _store;
  final bool _followingOnly;

  FeedNotifier(this._store, this._followingOnly);

  /// The normalized SQLite store — the source of truth the feed reads cold
  /// starts from, and the engagement index cards compute counts against.
  final EventStore _events = EventStore.instance;

  StreamSubscription<NostrEvent>? _liveSub;
  static const _pageSize = 50;

  /// Feed display kinds (posts, reposts, pictures, articles).
  static const _feedKinds = [1, 6, 16, 20, 30023];

  /// The follow list for the Following feed, resolved once per session —
  /// not on every page (that re-fetched kind-3 on every scroll and could
  /// flip the feed's author set mid-pagination).
  List<String>? _follows;

  /// Serializes refresh/loadMore so a pull-to-refresh near the bottom can't
  /// overlap a page fetch (which double-fetched the same window).
  Future<void> _inFlight = Future.value();

  @override
  FeedState build() {
    ref.onDispose(() => _liveSub?.cancel());
    // Re-fetch the follow list when the user logs in/out or follows someone.
    ref.listen(authStateProvider, (_, _) => _follows = null);
    // Show the cache immediately, then refresh behind it.
    Future.microtask(_init);
    return const FeedState();
  }

  Future<void> _init() async {
    // 1. Disk first — content on the first frame. Read from the SQLite
    // event store (indexed, survives >300 events); fall back to the legacy
    // JSON cache on the first run after upgrade.
    var cached = await _events.queryEvents(kinds: _feedKinds, limit: _pageSize);
    if (cached.isEmpty) {
      cached = await _store.read();
      if (cached.isNotEmpty) {
        // Migrate the legacy cache into SQLite once, then drop it.
        await _events.ingest(cached);
        await _store.clear();
      }
    }
    cached = cached.where(_isFeedPost).toList();
    if (cached.isNotEmpty) {
      state = state.copyWith(events: cached);
    }
    // 2. Network refresh behind it.
    await refresh();
    // 3. Live tail for new posts.
    _startLive();
  }

  /// Refresh the newest page and merge it in silently. Public for
  /// pull-to-refresh and the connectivity/app-resume watchers.
  ///
  /// HARD TIMEOUT: a hung relay fetch (dead socket, emulator's flaky route)
  /// would otherwise leave `isRefreshing` true FOREVER — the spinner spins
  /// forever and `if (state.isRefreshing) return` blocks every retry (the
  /// "feed stuck" bug). The timeout resets state so the next pull works.
  static const _refreshTimeout = Duration(seconds: 15);

  Future<void> refresh() {
    // Serialize against loadMore — an overlapping fetch double-loads a page.
    final run = _inFlight.then((_) => _refresh());
    _inFlight = run.catchError((_) {});
    return run;
  }

  /// Pull-to-refresh entry: clears a stuck `isRefreshing`/`isLoadingMore`
  /// flag from a previous hung fetch before starting, so a user pull ALWAYS
  /// gets a fresh attempt (the "pull does nothing when stuck" bug).
  Future<void> refreshFromPull() {
    if (state.isRefreshing || state.isLoadingMore) {
      state = state.copyWith(isRefreshing: false, isLoadingMore: false);
    }
    return refresh();
  }

  Future<void> _refresh() async {
    if (state.isRefreshing) return;
    state = state.copyWith(isRefreshing: true, clearError: true);
    try {
      await _refreshInner().timeout(_refreshTimeout, onTimeout: () {
        // A hung fetch: reset so the NEXT pull-to-refresh isn't blocked.
        // Keep the current events on screen (the cache is still good).
        state = state.copyWith(
          isRefreshing: false,
          error: 'Refresh timed out — pull to retry',
        );
      });
    } catch (e) {
      state = state.copyWith(isRefreshing: false, error: e.toString());
    }
  }

  Future<void> _refreshInner() async {
    try {
      final nostr = ref.read(nostrServiceProvider);
      if (!nostr.isInitialized) await nostr.init();

      List<NostrEvent> fresh;
      if (_followingOnly) {
        final auth = ref.read(authStateProvider);
        if (!auth.isLoggedIn || auth.pubkey == null) {
          state = state.copyWith(isRefreshing: false, hasMore: false);
          return;
        }
        final follows = await _resolveFollows();
        fresh = await nostr.fetchFollowingFeed(follows, limit: _pageSize);
      } else {
        fresh = await nostr.fetchFeed(limit: _pageSize);
      }

      // Replies (kind-1 with a thread parent) don't belong in the main feed
      // list — they read as context-free "posts" (the "replies show as
      // posts" bug). They still live in threads, the profile Replies tab,
      // and the store. Quotes and reposts stay (they're standalone content).
      fresh = fresh.where(_isFeedPost).toList();

      // Flood filter: drop near-duplicate / spray / rapid-fire spam (the
      // "same post every few minutes" junk) before it reaches the list.
      fresh = _applyFlood(fresh);

      final merged = _merge(state.events, fresh);
      state = state.copyWith(
        events: merged,
        isRefreshing: false,
        hasMore: fresh.length >= _pageSize ~/ 2,
        newCount: 0,
        lastSyncedAt: DateTime.now(),
      );
      // Persist the page into the SQLite store.
      await _events.ingest(fresh);
      // Background-warm the page's profiles + engagement so cards render
      // from cache instead of each firing its own relay query. Fire-and-
      // forget: posts render now, avatars/counts pop in as the batch lands.
      unawaited(_warmPage(fresh));
    } catch (e) {
      state = state.copyWith(isRefreshing: false, error: e.toString());
    }
  }

  /// Load the next (older) page and append it. No-op while one is loading.
  Future<void> loadMore() {
    final run = _inFlight.then((_) => _loadMore());
    _inFlight = run.catchError((_) {});
    return run;
  }

  Future<void> _loadMore() async {
    if (state.isLoadingMore ||
        state.isRefreshing ||
        !state.hasMore ||
        state.events.isEmpty) {
      return;
    }
    state = state.copyWith(isLoadingMore: true);
    try {
      await _loadMoreInner().timeout(_refreshTimeout, onTimeout: () {
        // Same hung-fetch guard as refresh: reset so pagination isn't stuck.
        state = state.copyWith(isLoadingMore: false);
      });
    } catch (_) {
      state = state.copyWith(isLoadingMore: false);
    }
  }

  Future<void> _loadMoreInner() async {
    try {
      final nostr = ref.read(nostrServiceProvider);
      if (!nostr.isInitialized) await nostr.init();

      final until = state.events.last.createdAt - 1;
      List<NostrEvent> older;
      if (_followingOnly) {
        older = await nostr.fetchFollowingFeed(
          await _resolveFollows(),
          limit: _pageSize,
          until: until,
        );
      } else {
        older = await nostr.fetchFeed(limit: _pageSize, until: until);
      }

      older = older.where(_isFeedPost).toList();
      older = _applyFlood(older);

      final merged = _merge(state.events, older);
      state = state.copyWith(
        events: merged,
        isLoadingMore: false,
        hasMore: older.length >= _pageSize ~/ 2,
      );
      await _events.ingest(older);
      unawaited(_warmPage(older));
    } catch (_) {
      state = state.copyWith(isLoadingMore: false);
    }
  }

  /// Warm a page's profiles + engagement in the background: batch-fetch the
  /// authors' kind-0s into the profile TTL cache (avatars/names) and the
  /// engagement events into the SQLite index (counts). One relay round-trip
  /// each instead of one per card.
  Future<void> _warmPage(List<NostrEvent> page) async {
    final nostr = ref.read(nostrServiceProvider);
    unawaited(nostr.prefetchProfiles(page.map((e) => e.pubkey).toList()));
    await _syncEngagement(page);
    // Keep the store bounded as it grows — LRU + byte budget, fire-and-forget
    // (never blocks the render path). X/FB evict on a budget too.
    unawaited(_events.prune());
  }

  /// Fetch engagement events (likes/reposts/replies/zaps) for a page of
  /// posts in ONE batched relay query and ingest them into the store, so
  /// each PostCard's counts come from a local SQL grouped count — not one
  /// relay round-trip per card (the ~150-queries-per-feed jank). The query
  /// asks for events that e-tag any of the page's posts.
  Future<void> _syncEngagement(List<NostrEvent> page) async {
    try {
      final ids = page.map((e) => e.id).toList();
      if (ids.isEmpty) return;
      final nostr = ref.read(nostrServiceProvider);
      final engagementEvents = await nostr.relayPool.query([
        NostrFilter(
          kinds: const [1, 6, 7, 16, 9735, 1111],
          tagFilters: {'e': ids},
          limit: 1000,
        ),
      ], timeout: const Duration(seconds: 6));
      await _events.ingest(engagementEvents);
      // Tell listeners the counts are fresh.
      ref.read(engagementVersionProvider.notifier).state++;
    } catch (_) {
      // Best-effort: counts from the last sync still render.
    }
  }

  /// The follow list for the Following feed, cached per session. Follow/
  /// unfollow invalidates it via the auth listener in [build].
  Future<List<String>> _resolveFollows() async {
    final cached = _follows;
    if (cached != null) return cached;
    final auth = ref.read(authStateProvider);
    if (auth.pubkey == null) return const [];
    final nostr = ref.read(nostrServiceProvider);
    final follows = await nostr.fetchFollows(auth.pubkey!);
    _follows = follows;
    return follows;
  }

  /// Restart the live tail — called after app resume / reconnect, when the
  /// old subscription's sockets are dead.
  void restartLive() => _startLive();

  /// Fold the live-arrived new posts into the list (the pill's action).
  void showNewPosts() {
    final pending = _pending;
    if (pending.isEmpty) return;
    final merged = _merge(state.events, pending);
    _pending = [];
    state = state.copyWith(events: merged, newCount: 0);
    _store.write(merged);
  }

  // ── Live subscription ──────────────────────────────────────────────

  List<NostrEvent> _pending = [];

  void _startLive() {
    final nostr = ref.read(nostrServiceProvider);
    if (!nostr.isInitialized) return;

    final since = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    NostrFilter filter;
    if (_followingOnly) {
      // Following feed's live tail: posts by people the user follows. The
      // author list can be large — cap it so the filter stays reasonable
      // (a refresh covers anyone past the cap).
      final authors = _follows;
      if (authors == null || authors.isEmpty) return;
      filter = NostrFilter(
        kinds: const [1, 6, 16, 20, 30023],
        since: since,
        limit: 200,
        authors: authors.length > 500 ? authors.sublist(0, 500) : authors,
      );
    } else {
      filter = NostrFilter(
        kinds: const [1, 6, 16, 20, 30023],
        since: since,
        limit: 200,
      );
    }

    _liveSub?.cancel();
    _liveSub = nostr.relayPool.subscribe([filter]).listen((event) {
      // Ingest live posts AND engagement events into the store as they
      // arrive so counts stay warm.
      _events.ingest([event]);
      // Replies don't count toward the "N new posts" pill — they're not
      // standalone feed posts (same rule as the page fetches).
      if (!_isFeedPost(event)) return;
      // Flood check (same rule as the page fetches) — spray/flood spam
      // never reaches the pill.
      final detector = ref.read(floodDetectorProvider);
      final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      detector.observe(event, nowSeconds: now);
      if (detector.verdictFor(event, nowSeconds: now) != FloodVerdict.clean) {
        return;
      }
      // Count, don't insert — auto-inserting yanks the scroll position.
      if (_pending.any((e) => e.id == event.id)) return;
      if (state.events.any((e) => e.id == event.id)) return;
      _pending = [..._pending, event];
      state = state.copyWith(newCount: _pending.length);
    });
  }

  /// Whether an event belongs in the main feed LIST: everything except a
  /// kind-1 REPLY (a post with a thread parent). Replies read as context-
  /// free "posts" in a flat feed; they belong in threads + the profile
  /// Replies tab. Quotes (q tag, not a reply), reposts, pictures, videos,
  /// articles, and polls all stay.
  static bool _isFeedPost(NostrEvent e) {
    if (e.kind == 1 && e.isReply) return false;
    return true;
  }

  /// Observe a page into the flood detector (arrival order) and drop the
  /// events that trip it. Legit posts pass straight through; only
  /// near-duplicate floods, sprays, and rapid-fire bursts are removed.
  List<NostrEvent> _applyFlood(List<NostrEvent> events) {
    final detector = ref.read(floodDetectorProvider);
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final kept = <NostrEvent>[];
    for (final e in events) {
      detector.observe(e, nowSeconds: now);
      if (detector.verdictFor(e, nowSeconds: now) == FloodVerdict.clean) {
        kept.add(e);
      }
    }
    return kept;
  }

  /// How far in the future a post's timestamp may be before we stop trusting
  /// it for ordering. Relay clock skew and (worse) boosted/manipulated posts
  /// can carry a future `created_at` — sorted naively, that pins the post at
  /// the TOP of the feed forever ("one post always stuck on top"). We clamp
  /// anything beyond this window to "now" for ordering, so it sorts with
  /// the genuinely-new posts instead of floating above them.
  static const _futureToleranceSeconds = 15 * 60; // 15 minutes

  /// The timestamp we ORDER a post by: its `created_at`, clamped to now +
  /// tolerance. A future-dated post is treated as "just posted", not "top of
  /// all time".
  static int _orderTs(NostrEvent e, int nowSeconds) {
    final cap = nowSeconds + _futureToleranceSeconds;
    return e.createdAt > cap ? nowSeconds : e.createdAt;
  }

  /// Merge incoming events into the current list WITHOUT re-ordering what
  /// is already on screen. Existing events keep their position (a refresh
  /// never makes the post the user is reading jump); genuinely new events
  /// are inserted by time into the stable existing order. NIP-17 backdated
  /// posts and relay clock skew can make a full re-sort shuffle the visible
  /// list — that's the "feed jumps while scrolling" bug.
  static List<NostrEvent> _merge(
    List<NostrEvent> current,
    List<NostrEvent> incoming,
  ) {
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    if (current.isEmpty) {
      final sorted = [...incoming]
        ..sort((a, b) => _orderTs(b, now).compareTo(_orderTs(a, now)));
      return _dedupe(sorted);
    }
    final existingIds = current.map((e) => e.id).toSet();
    final newOnes =
        incoming.where((e) => !existingIds.contains(e.id)).toList();
    if (newOnes.isEmpty) return current;

    // Insert each new event at its time-sorted position (future-clamped).
    // Existing events never move relative to one another.
    final result = [...current];
    for (final e in newOnes) {
      final ts = _orderTs(e, now);
      var insertAt = result.length;
      for (var i = 0; i < result.length; i++) {
        if (_orderTs(result[i], now) < ts) {
          insertAt = i;
          break;
        }
      }
      result.insert(insertAt, e);
    }
    return result;
  }

  static List<NostrEvent> _dedupe(List<NostrEvent> events) {
    final seen = <String>{};
    return events.where((e) => seen.add(e.id)).toList();
  }
}

/// A monotonic counter bumped whenever engagement events land in the store.
/// PostCards watch this to recompute their counts from the local SQL index —
/// row-scoped rebuilds instead of every card rebuilding on every provider
/// fan-out (the other half of the feed-jank fix).
final engagementVersionProvider = StateProvider<int>((ref) => 0);

/// Local engagement counts for one event, straight from the SQLite index.
/// Replaces the per-event `engagementProvider` relay query in the feed.
final localEngagementProvider =
    FutureProvider.family<EventCounts, String>((ref, eventId) async {
  // Recompute whenever a new engagement batch lands.
  ref.watch(engagementVersionProvider);
  final map = await EventStore.instance.engagementFor([eventId]);
  return map[eventId] ?? EventCounts();
});

/// Global ("For You") feed.
final globalFeedProvider = NotifierProvider<FeedNotifier, FeedState>(
  () => FeedNotifier(FeedStore.global, false),
);

/// Following feed (posts by people the user follows).
final followingFeedNotifierProvider =
    NotifierProvider<FeedNotifier, FeedState>(
  () => FeedNotifier(FeedStore.following, true),
);
