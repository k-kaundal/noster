import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/flood_detector.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/explore/domain/feed_ranking.dart';
import 'package:nostrfeed_mobile/features/feed/application/feed_store.dart';
import 'package:nostrfeed_mobile/features/feed/application/personalization_service.dart';

// engagementVersionProvider / localEngagementProvider moved to core in P3
// (the ingest pipeline bumps them from the bus). Re-exported so existing
// feed-side imports keep working.
export 'package:nostrfeed_mobile/core/providers/content_providers.dart'
    show engagementVersionProvider, localEngagementProvider;

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

  /// Distinct authors of the newest pending posts (max 3, newest first) —
  /// the avatar stack on the "N new posts" pill. Empty when [newCount] is 0.
  final List<String> newPostAuthors;

  /// The last fetch failed; the cached/current events stay visible.
  final String? error;

  /// When the events last came from the network (vs the disk cache).
  final DateTime? lastSyncedAt;

  const FeedState({
    this.events = const [],
    // Start TRUE: the very first frame after build() must be the skeleton,
    // never the empty state. Before this, `isRefreshing: false` made frame
    // one evaluate `events.isEmpty && !isRefreshing` → the "No posts" empty
    // state flashed for the 1-2s the disk read + refresh took (the "app
    // opens to 'no posts' then fills" bug — real apps open to cached/skeleton,
    // never an empty state).
    this.isRefreshing = true,
    this.hasMore = true,
    this.isLoadingMore = false,
    this.newCount = 0,
    this.newPostAuthors = const [],
    this.error,
    this.lastSyncedAt,
  });

  FeedState copyWith({
    List<NostrEvent>? events,
    bool? isRefreshing,
    bool? hasMore,
    bool? isLoadingMore,
    int? newCount,
    List<String>? newPostAuthors,
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
      newPostAuthors: newPostAuthors ?? this.newPostAuthors,
      error: clearError ? null : (error ?? this.error),
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
    );
  }
}

/// Which feed tab a notifier serves.
enum FeedMode {
  /// Unfiltered firehose (the old "For You" — everything the hub syncs).
  global,

  /// Personalized: interest + country + language + followers-mixed ranking
  /// over the global candidate set.
  forYou,

  /// Only posts by people the user follows.
  following,
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
  final FeedMode _mode;

  FeedNotifier(this._store, this._mode);

  bool get _followingOnly => _mode == FeedMode.following;
  bool get _isForYou => _mode == FeedMode.forYou;

  /// The normalized SQLite store — the source of truth the feed reads cold
  /// starts from, and the engagement index cards compute counts against.
  final EventStore _events = EventStore.instance;

  StreamSubscription<NostrEvent>? _liveSub;
  EventBusHandle? _liveHandle;
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
    ref.onDispose(() {
      _liveSub?.cancel();
      _liveHandle?.dispose();
    });
    // Re-fetch the follow list when the user logs in/out or follows someone,
    // AND re-run the refresh: clearing _follows without re-fetching left the
    // Following tab empty until a manual pull after every login/account
    // switch (the "logged in but Following shows no posts" bug).
    ref.listen(authStateProvider, (prev, next) {
      _follows = null;
      if (prev?.pubkey != next.pubkey) {
        _pending = [];
        _pendingIds.clear();
        state = const FeedState(isRefreshing: false);
        Future.microtask(_init);
      }
    });
    // Follow/unfollow from anywhere (profile button, search, explore): the
    // cached _follows goes stale AND the live tail's author filter is wrong
    // until a refresh — resolve follows + re-arm the tail so a newly
    // followed author's posts start arriving immediately.
    ref.listen(followsProvider, (prev, next) {
      final newFollows = next.valueOrNull;
      if (newFollows == null) return;
      final old = prev?.valueOrNull;
      if (old != null &&
          old.length == newFollows.length &&
          old.toSet().containsAll(newFollows)) {
        return; // same set — nothing to do
      }
      _follows = null; // force re-resolve on next refresh
      if (_followingOnly) {
        // refresh() resolves follows and re-arms the live tail itself
        // (the _refreshInner fix) — one entry point, no ordering traps.
        refresh();
      }
    });
    // Show the cache immediately, then refresh behind it.
    Future.microtask(_init);
    return const FeedState();
  }

  Future<void> _init() async {
    // 1. Disk first — content on the first frame. ADR-0005 L5: the feed is a
    // SQL projection (feedPage) — reply filtering happens IN the query via
    // thread_edges (correct for replies from ANY ingest path, not just the
    // feed's own fetches).
    //
    // The Following tab NEVER waits on the network for this first paint:
    // `_resolveFollows` does a relay fetch, and awaiting it here meant a
    // cold start with slow relays hung the tab on a skeleton — and a thrown
    // fetch (offline) killed the whole tab (no paint, no refresh, no live
    // tail). Follows resolve IN PARALLEL: the disk read uses whatever is
    // already cached (possibly none on a fresh session — a Following tab
    // with unknown follows paints EMPTY, never the global feed), and once
    // the refresh resolves them the feed fills in.
    List<String>? authors;
    if (_followingOnly) {
      // Paint from the store with whatever follows are ALREADY cached —
      // don't wait for the network. CRITICAL: feedPage(authors: []) is
      // UNFILTERED (it returns the GLOBAL store), so an empty follows list
      // must NOT be passed — that leaked global posts into the Following
      // tab on every cold start. Unknown follows → skip the store read
      // entirely (paint empty), the refresh resolves follows + fills in.
      final known = _follows;
      if (known == null || known.isEmpty) {
        authors = null; // sentinel: skip the store read below
      } else {
        authors = known;
      }
    }

    var cached = <NostrEvent>[];
    if (!(_followingOnly && authors == null)) {
      cached = await _events.feedPage(
        kinds: _feedKinds,
        limit: _isForYou ? _pageSize * 3 : _pageSize,
        authors: authors,
      );
      // For You: rank the store paint too — the cold-start feed is already
      // personalized (interests/country/language from the last session).
      if (_isForYou && cached.isNotEmpty) {
        cached = await _rankCached(cached);
      }
    }
    if (cached.isEmpty && !(_followingOnly && authors == null)) {
      final legacy = await _store.read();
      if (legacy.isNotEmpty) {
        // Migrate the legacy cache into SQLite once, then drop it.
        await _events.ingest(legacy);
        await _store.clear();
        // Apply the SAME filters as the SQL read — the migration must not
        // leak global posts into the Following tab.
        cached = legacy.where((e) {
          if (!_isFeedPost(e)) return false;
          if (authors != null && !authors.contains(e.pubkey)) return false;
          return true;
        }).toList();
      }
    }
    if (cached.isNotEmpty) {
      state = state.copyWith(events: cached);
    }
    // Clear the INITIAL isRefreshing flag before the first refresh: the
    // flag starts true ONLY so frame 1 shows the skeleton (never the empty
    // state) — it is NOT a real in-flight fetch. `_refresh()` guards on
    // `if (state.isRefreshing) return`, so without clearing it here the
    // very first refresh returned immediately and the flag stayed stuck
    // true FOREVER → skeleton forever on any tab whose store paint is
    // empty (the Following tab on a cold start — For You masked it because
    // its store paint is non-empty, so events.isEmpty was false).
    if (state.isRefreshing) {
      state = state.copyWith(isRefreshing: false);
    }
    // 2. Network refresh behind it (resolves follows for the Following tab).
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
  ///
  /// ALSO folds the pill's pending posts into the list FIRST. After the P3
  /// pipeline change, live posts land in the store + pill the moment they
  /// arrive, so a pull-to-refresh that only re-merges the relay page could
  /// show NO visible change (the "pull-to-refresh doesn't work" report) —
  /// the genuinely-new posts were pending behind the pill, not in the list.
  /// A user pull is an explicit "show me what's new" — honor it.
  Future<void> refreshFromPull() {
    if (state.isRefreshing || state.isLoadingMore) {
      state = state.copyWith(isRefreshing: false, isLoadingMore: false);
      // Drop the serialized queue too: the flags were stuck because the
      // in-flight fetch HUNG (Android kills idle sockets — a 5s relay-init
      // wait + 8s query ≈ the 15s timeout). Queuing this pull behind the
      // hung fetch made pulls "do nothing" until it timed out (the "feed
      // stuck on Android" bug — iOS sockets survive, so the chain never
      // grew there). The hung future still completes on its own; its stale
      // merge is harmless (time-ordered, deduped).
      _inFlight = Future.value();
    }
    showNewPosts();
    return refresh();
  }

  Future<void> _refresh() async {
    if (state.isRefreshing) return;
    state = state.copyWith(isRefreshing: true, clearError: true);
    try {
      await _refreshInner().timeout(
        _refreshTimeout,
        onTimeout: () {
          // A hung fetch: reset so the NEXT pull-to-refresh isn't blocked.
          // Keep the current events on screen (the cache is still good).
          state = state.copyWith(
            isRefreshing: false,
            error: 'Refresh timed out — pull to retry',
          );
        },
      );
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
        // (Re-)arm the live tail once follows exist — the _init-time
        // _startLive() returns early when follows are unknown (cold start /
        // failed first refresh), and nothing re-armed it: the Following
        // tab's "N new posts" pill simply never worked until an app resume
        // called restartLive. Arming here guarantees it after EVERY
        // successful follows resolution.
        if (follows.isNotEmpty) _startLive();

        // Cold-start fix: if the feed had painted EMPTY (follows unknown at
        // _init), fill from the store NOW that follows exist — the network
        // page can be thin/empty on quiet relays, but the store already has
        // posts by followed authors from the shared ingest pipeline. Without
        // this the tab stayed empty until a page arrived (the "Following
        // blank on cold start" bug).
        if (state.events.isEmpty && follows.isNotEmpty) {
          final fromStore = await _events.feedPage(
            kinds: _feedKinds,
            limit: _pageSize,
            authors: follows,
          );
          if (fromStore.isNotEmpty) {
            fresh = _dedupe([...fresh, ...fromStore]);
          }
        }
      } else if (_isForYou) {
        // FOR YOU: fetch a global candidate pool, rank it with the
        // personalization boost (interests + country + language + follows),
        // and mix in followed authors' posts. The candidate pool is wider
        // than the page so the ranking has room to personalize.
        fresh = await _fetchForYouPage(nostr);
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

      // Refresh anchors at the TOP: keep the newest — the fresh page must
      // survive the window cap (the "refresh discards itself" bug).
      final merged = _merge(state.events, fresh, anchoredAtTop: true);
      state = state.copyWith(
        events: merged,
        isRefreshing: false,
        hasMore: fresh.length >= _pageSize ~/ 2,
        newCount: 0,
        newPostAuthors: const [],
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

  /// Rank a store-painted candidate list with the same personalization
  /// boost as the relay path (cold start is personalized too).
  Future<List<NostrEvent>> _rankCached(List<NostrEvent> cached) async {
    try {
      final profile = await ref.read(personalizationProvider.future);
      if (profile.isEmpty) return cached.take(_pageSize).toList();
      final ids = cached.map((e) => e.id).toList();
      final engagementMap = await _events.engagementFor(ids);
      final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      final authorCounts = FeedRanking.authorCounts(cached);
      final scored = cached.map((e) {
        final engRow = engagementMap[e.id];
        final eng = EventEngagement(
          replies: engRow?.replies ?? 0,
          reactions: engRow?.reactions ?? 0,
          reposts: engRow?.reposts ?? 0,
          zaps: engRow?.zaps ?? 0,
          uniqueEngagers: engRow?.uniqueEngagers ?? 0,
        );
        final base = FeedRanking.trendingScore(
          engagement: eng,
          createdAt: e.createdAt,
          nowSeconds: nowSeconds,
          authorPostCountInWindow: authorCounts[e.pubkey] ?? 1,
        );
        return (
          event: e,
          score: base * personalizationBoost(event: e, profile: profile),
        );
      }).toList()..sort((a, b) => b.score.compareTo(a.score));
      final taken = <String, int>{};
      final result = <NostrEvent>[];
      for (final s in scored) {
        final n = taken[s.event.pubkey] ?? 0;
        if (n >= 3) continue;
        taken[s.event.pubkey] = n + 1;
        result.add(s.event);
        if (result.length >= _pageSize) break;
      }
      return result;
    } catch (_) {
      return cached.take(_pageSize).toList();
    }
  }

  /// FOR YOU page: global candidates ranked by the personalization boost,
  /// blended with followed authors' posts (~40/60 follow/discovery).
  ///
  /// Ranking rides the ANTI-MANIPULATION trending score (unique engagers,
  /// zaps, freshness decay) — personalization re-orders genuine content, it
  /// never inflates bot clusters. The engagement numbers come from the LOCAL
  /// store index first (instant), refreshed behind by `_warmPage`.
  Future<List<NostrEvent>> _fetchForYouPage(
    NostrService nostr, {
    int? until,
  }) async {
    // Wider candidate pool so ranking has room to personalize.
    const candidateLimit = _pageSize * 3;
    final candidates = await nostr.fetchFeed(
      limit: candidateLimit,
      until: until,
    );
    if (candidates.isEmpty) return candidates;

    final profile = await ref.read(personalizationProvider.future);
    if (profile.isEmpty) {
      // Logged out / no signals yet: For You = the global feed (honest —
      // there is nothing to personalize with).
      return candidates.take(_pageSize).toList();
    }

    // Engagement from the LOCAL index (warm from previous syncs — ranking
    // never waits on a relay round-trip per candidate).
    final ids = candidates.map((e) => e.id).toList();
    final engagementMap = await _events.engagementFor(ids);
    final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final authorCounts = FeedRanking.authorCounts(candidates);

    // Score: trending × personalization boost.
    final scored = candidates.map((e) {
      final engRow = engagementMap[e.id];
      final eng = EventEngagement(
        replies: engRow?.replies ?? 0,
        reactions: engRow?.reactions ?? 0,
        reposts: engRow?.reposts ?? 0,
        zaps: engRow?.zaps ?? 0,
        uniqueEngagers: engRow?.uniqueEngagers ?? 0,
      );
      final base = FeedRanking.trendingScore(
        engagement: eng,
        createdAt: e.createdAt,
        nowSeconds: nowSeconds,
        authorPostCountInWindow: authorCounts[e.pubkey] ?? 1,
      );
      final boost = personalizationBoost(event: e, profile: profile);
      return (event: e, score: base * boost);
    }).toList()..sort((a, b) => b.score.compareTo(a.score));

    // Blend: ~40% followed authors (the "followers mix" — the Following
    // tab's people also surface here), ~60% ranked discovery. Per-author
    // cap 3 so no one dominates (same as FeedRanking.rank).
    final result = <NostrEvent>[];
    final resultIds = <String>{};
    final taken = <String, int>{};
    final followedTarget = (_pageSize * 0.4).round();

    // Pass 1: best-scored followed posts first (up to the 40% target).
    var followedCount = 0;
    for (final s in scored) {
      if (result.length >= _pageSize || followedCount >= followedTarget) {
        break;
      }
      if (!profile.follows.contains(s.event.pubkey)) continue;
      final n = taken[s.event.pubkey] ?? 0;
      if (n >= 3) continue;
      taken[s.event.pubkey] = n + 1;
      result.add(s.event);
      resultIds.add(s.event.id);
      followedCount++;
    }
    // Pass 2: fill the rest by score (any author — followed posts can also
    // win slots here on merit).
    for (final s in scored) {
      if (result.length >= _pageSize) break;
      if (resultIds.contains(s.event.id)) continue;
      final n = taken[s.event.pubkey] ?? 0;
      if (n >= 3) continue;
      taken[s.event.pubkey] = n + 1;
      result.add(s.event);
      resultIds.add(s.event.id);
    }
    return result;
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
      await _loadMoreInner().timeout(
        _refreshTimeout,
        onTimeout: () {
          // Same hung-fetch guard as refresh: reset so pagination isn't stuck.
          state = state.copyWith(isLoadingMore: false);
        },
      );
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
      } else if (_isForYou) {
        older = await _fetchForYouPage(nostr, until: until);
      } else {
        older = await nostr.fetchFeed(limit: _pageSize, until: until);
      }

      older = older.where(_isFeedPost).toList();
      older = _applyFlood(older);

      // loadMore anchors at the BOTTOM: keep the oldest — the pagination
      // cursor (`events.last.createdAt`) must survive the cap to keep
      // scrolling back through history.
      final merged = _merge(state.events, older, anchoredAtTop: false);
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
  ///
  /// NIP-57 zap receipts (kind 9735) are validated: the receipt's pubkey
  /// must match the recipient's LNURL provider's `nostrPubkey`, and the
  /// bolt11 amount must match the zap request's amount tag. Invalid receipts
  /// are dropped (a rogue LNURL server can forge them).
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
      // NIP-57: validate zap receipts before ingesting — a forged receipt
      // (wrong pubkey, mismatched amount) inflates zap counts dishonestly.
      final validated = <NostrEvent>[];
      for (final e in engagementEvents) {
        if (e.kind == 9735) {
          if (_isValidZapReceipt(e)) {
            validated.add(e);
          }
          // Drop invalid receipts — don't poison the engagement index.
        } else {
          validated.add(e);
        }
      }
      // The ingest reports its changed tables (StoreTable.eventRefs) to the
      // invalidation bus via the writer lane — `engagementVersionProvider`
      // derives from that, so listeners recount automatically. No manual
      // version poke here anymore (ADR-0008 P5).
      await _events.ingest(validated);
    } catch (_) {
      // Best-effort: counts from the last sync still render.
    }
  }

  /// NIP-57 Appendix F: validate a zap receipt.
  ///
  /// Checks:
  /// 1. The receipt has a bolt11 tag (proof of invoice).
  /// 2. The receipt has a description tag with the zap request JSON.
  /// 3. The zap request's amount tag matches the bolt11 invoice amount
  ///    (when parseable).
  ///
  /// Returns true for receipts that pass validation (or can't be fully
  /// validated but aren't obviously forged).
  static bool _isValidZapReceipt(NostrEvent receipt) {
    // Must have a bolt11 invoice.
    final bolt11 = receipt.getTag('bolt11');
    if (bolt11 == null || bolt11.isEmpty) return false;
    // Must have a description with the zap request.
    final desc = receipt.getTag('description');
    if (desc == null || desc.isEmpty) return false;
    // The description must be valid JSON (the zap request).
    try {
      final req = jsonDecode(desc) as Map<String, dynamic>;
      // The zap request must have an amount tag.
      final tags = req['tags'] as List?;
      if (tags == null) return false;
      var hasAmount = false;
      for (final tag in tags) {
        if (tag is List && tag.isNotEmpty && tag[0] == 'amount') {
          hasAmount = true;
          break;
        }
      }
      if (!hasAmount) return false;
    } catch (_) {
      return false; // Unparseable description = invalid receipt.
    }
    return true;
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
    _pending = [];
    _pendingIds.clear();
    // For You: rank the pending batch with personalization before merging —
    // a followed author's live post lands ABOVE a random one (the point of
    // the tab), instead of naive time order.
    if (_isForYou) {
      _rankCached(pending).then((ranked) {
        final merged = _merge(state.events, ranked, anchoredAtTop: true);
        state = state.copyWith(
          events: merged,
          newCount: 0,
          newPostAuthors: const [],
        );
      });
      return;
    }
    // The pill's posts are the NEWEST — keep them (a tap that made them
    // vanish into the window cap was the "pill does nothing" bug).
    final merged = _merge(state.events, pending, anchoredAtTop: true);
    state = state.copyWith(
      events: merged,
      newCount: 0,
      newPostAuthors: const [],
    );
    // NO legacy FeedStore write here — persistence is the SQLite EventStore's
    // job (the live tail ingests via the ADR-0005 pipeline; page fetches call
    // `_events.ingest`). The JSON FeedStore is migration-read-once-only; a
    // full-list JSON write on every pill tap was double-write amplification.
  }

  // ── Live subscription ──────────────────────────────────────────────

  /// Live-tail buffer for the "N new posts" pill, plus its dedup index.
  /// Bounded at [_maxPending] (see the live listener for the drop-oldest
  /// rule) — an uncapped buffer was a slow-scroll memory/cost creep.
  List<NostrEvent> _pending = [];
  final Set<String> _pendingIds = {};

  /// Cap on the live-tail pill buffer. 100 ≈ two busy minutes of a fast
  /// global relay — beyond that the pill just says "100+" territory anyway.
  static const _maxPending = 100;

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

    // ADR-0005: acquire on the shared EventBus + filter the union stream
    // locally, instead of owning a raw relay subscription. The global feed
    // tail and the social listener now share REQs when their filters match,
    // and cross-spec events are deduped once at the bus.
    _liveHandle?.dispose();
    _liveSub?.cancel();
    final bus = ref.read(eventBusProvider);
    final spec = [filter];
    _liveHandle = bus.acquire(spec);
    _liveSub = bus.stream.where(spec.matchesAny).listen((event) {
      // ADR-0005 P3: ingestion is the ingest pipeline's job (every gated bus
      // event lands in the store once), and flood-judgment is the bus gate's
      // job (sprays/rapid-fire never reach this listener). The live tail is
      // now ONLY the "N new posts" pill.
      // Replies don't count toward the pill — they're not standalone feed
      // posts (same rule as the page fetches).
      if (!_isFeedPost(event)) return;
      // Count, don't insert — auto-inserting yanks the scroll position.
      // Dedup via a Set (O(1), not an O(n) `.any()` scan per live event —
      // a fast relay made this O(n·m) on the UI thread). And CAP the buffer:
      // a busy tail between pill taps accumulated unboundedly, each entry a
      // `[..._pending, event]` copy of the whole list. At the cap we drop
      // the OLDEST pending — the user can only act on the newest anyway, and
      // the dropped ones are still in the SQLite store.
      if (_pendingIds.contains(event.id)) return;
      if (state.events.any((e) => e.id == event.id)) return;
      if (_pending.length >= _maxPending) {
        final dropped = _pending.removeAt(0);
        _pendingIds.remove(dropped.id);
      }
      _pending.add(event);
      _pendingIds.add(event.id);
      state = state.copyWith(
        newCount: _pending.length,
        newPostAuthors: _pendingAuthors(),
      );
    });
  }

  /// Distinct authors of the newest pending posts, max 3, newest first —
  /// the avatar stack on the pill.
  List<String> _pendingAuthors() {
    final out = <String>[];
    for (final e in _pending.reversed) {
      if (!out.contains(e.pubkey)) out.add(e.pubkey);
      if (out.length == 3) break;
    }
    return out;
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
    List<NostrEvent> incoming, {
    required bool anchoredAtTop,
  }) {
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    if (current.isEmpty) {
      final sorted = [...incoming]
        ..sort((a, b) => _orderTs(b, now).compareTo(_orderTs(a, now)));
      return _capWindow(_dedupe(sorted), anchoredAtTop: anchoredAtTop);
    }
    final existingIds = current.map((e) => e.id).toSet();
    final newOnes = incoming.where((e) => !existingIds.contains(e.id)).toList();
    if (newOnes.isEmpty) {
      return _capWindow(current, anchoredAtTop: anchoredAtTop);
    }

    // Insert each new event at its time-sorted position (future-clamped).
    // Existing events never move relative to one another.
    final result = [...current];
    for (final e in newOnes) {
      final ts = _orderTs(e, now);
      // Binary-search the insertion point (list is sorted newest-first) —
      // O(log n) instead of the old O(n) linear scan per event, so a page
      // merge is O(m log n) instead of O(n·m) (quadratic jank as the feed
      // grew).
      var lo = 0;
      var hi = result.length;
      while (lo < hi) {
        final mid = (lo + hi) >> 1;
        if (_orderTs(result[mid], now) >= ts) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      result.insert(lo, e);
    }
    return _capWindow(result, anchoredAtTop: anchoredAtTop);
  }

  /// In-memory feed window cap. Without it `state.events` grew by ~50 per
  /// page forever — after ~20 pages a 1000-event list made every merge,
  /// scroll, and `itemCount` rebuild O(n) with growing n, and kept 1000
  /// keyed elements alive in the ListView. THAT is the "scroll gets stuck
  /// after a while" smoking gun.
  ///
  /// The cap is DIRECTION-AWARE — the old rule always dropped from the TOP
  /// (newest), which created the "index-0 stuck / new posts never show"
  /// bug: after scrolling past 400 events, a refresh merged the new page at
  /// the top and the cap immediately discarded it, so the top post stayed
  /// pinned and the "N new posts" pill's posts vanished on tap.
  ///
  ///  - **anchoredAtTop (refresh + pill)** → keep the NEWEST. The user is at
  ///    the top looking at fresh content; the oldest fall out of memory (they
  ///    stay in the SQLite store, so pagination back-fills them seamlessly).
  ///  - **loadMore (scrolling down)** → keep the OLDEST. The pagination
  ///    cursor is `state.events.last.createdAt`, so the tail must survive to
  ///    scroll back through history; the newest drop out (re-fetched on the
  ///    next refresh).
  ///
  /// 400 ≈ 8 pages — plenty of scroll-back head-room while bounding memory.
  static const _maxInMemoryEvents = 400;

  static List<NostrEvent> _capWindow(
    List<NostrEvent> events, {
    required bool anchoredAtTop,
  }) {
    if (events.length <= _maxInMemoryEvents) return events;
    return anchoredAtTop
        ? events.take(_maxInMemoryEvents).toList()
        : events.sublist(events.length - _maxInMemoryEvents);
  }

  static List<NostrEvent> _dedupe(List<NostrEvent> events) {
    final seen = <String>{};
    return events.where((e) => seen.add(e.id)).toList();
  }
}

/// Global feed (unfiltered — everything the hub syncs).
final globalFeedProvider = NotifierProvider<FeedNotifier, FeedState>(
  () => FeedNotifier(FeedStore.global, FeedMode.global),
);

/// For You feed (personalized: interests + country + language + followers).
final forYouFeedProvider = NotifierProvider<FeedNotifier, FeedState>(
  () => FeedNotifier(FeedStore.forYou, FeedMode.forYou),
);

/// Following feed (posts by people the user follows).
final followingFeedNotifierProvider = NotifierProvider<FeedNotifier, FeedState>(
  () => FeedNotifier(FeedStore.following, FeedMode.following),
);
