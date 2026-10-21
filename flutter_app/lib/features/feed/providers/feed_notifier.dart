import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/feed/providers/feed_store.dart';

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

  StreamSubscription<NostrEvent>? _liveSub;
  static const _pageSize = 50;

  @override
  FeedState build() {
    ref.onDispose(() => _liveSub?.cancel());
    // Show the cache immediately, then refresh behind it.
    Future.microtask(_init);
    return const FeedState();
  }

  Future<void> _init() async {
    // 1. Disk first — content on the first frame.
    final cached = await _store.read();
    if (cached.isNotEmpty) {
      state = state.copyWith(events: cached);
    }
    // 2. Network refresh behind it.
    await refresh();
    // 3. Live tail for new posts.
    _startLive();
  }

  Future<void> refresh() async {
    if (state.isRefreshing) return;
    state = state.copyWith(isRefreshing: true, clearError: true);
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
        final follows = await nostr.fetchFollows(auth.pubkey!);
        fresh = await nostr.fetchFollowingFeed(follows, limit: _pageSize);
      } else {
        fresh = await nostr.fetchFeed(limit: _pageSize);
      }

      final merged = _merge(state.events, fresh);
      state = state.copyWith(
        events: merged,
        isRefreshing: false,
        hasMore: fresh.length >= _pageSize ~/ 2,
        newCount: 0,
        lastSyncedAt: DateTime.now(),
      );
      await _store.write(merged);
    } catch (e) {
      state = state.copyWith(isRefreshing: false, error: e.toString());
    }
  }

  /// Load the next (older) page and append it. No-op while one is loading.
  Future<void> loadMore() async {
    if (state.isLoadingMore || !state.hasMore || state.events.isEmpty) return;
    state = state.copyWith(isLoadingMore: true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      if (!nostr.isInitialized) await nostr.init();

      final until = state.events.last.createdAt - 1;
      List<NostrEvent> older;
      if (_followingOnly) {
        final auth = ref.read(authStateProvider);
        final follows = await nostr.fetchFollows(auth.pubkey!);
        older = await nostr.fetchFollowingFeed(
          follows,
          limit: _pageSize,
          until: until,
        );
      } else {
        older = await nostr.fetchFeed(limit: _pageSize, until: until);
      }

      final merged = _merge(state.events, older);
      state = state.copyWith(
        events: merged,
        isLoadingMore: false,
        hasMore: older.length >= _pageSize ~/ 2,
      );
      await _store.write(merged);
    } catch (_) {
      state = state.copyWith(isLoadingMore: false);
    }
  }

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
    final filters = <NostrFilter>[
      if (_followingOnly) ...[
        // Following feed's live tail: posts by people the user follows.
        // (Author list is large; skip the live tail rather than a huge
        // filter — refresh covers it.)
      ] else ...[
        NostrFilter(kinds: [1, 6, 16, 20, 30023], since: since, limit: 200),
      ],
    ];
    if (filters.isEmpty) return;

    _liveSub?.cancel();
    _liveSub = nostr.relayPool.subscribe(filters).listen((event) {
      // Count, don't insert — auto-inserting yanks the scroll position.
      if (_pending.any((e) => e.id == event.id)) return;
      if (state.events.any((e) => e.id == event.id)) return;
      _pending = [..._pending, event];
      state = state.copyWith(newCount: _pending.length);
    });
  }

  /// Merge two event lists, deduped by id, newest first. Existing order is
  /// preserved for events already on screen; genuinely new ones sort in by
  /// time — so a refresh never re-orders what the user is reading.
  static List<NostrEvent> _merge(
    List<NostrEvent> current,
    List<NostrEvent> incoming,
  ) {
    final byId = {for (final e in current) e.id: e};
    for (final e in incoming) {
      byId[e.id] = e;
    }
    final merged = byId.values.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return merged;
  }
}

/// Global ("For You") feed.
final globalFeedProvider = NotifierProvider<FeedNotifier, FeedState>(
  () => FeedNotifier(FeedStore.global, false),
);

/// Following feed (posts by people the user follows).
final followingFeedNotifierProvider =
    NotifierProvider<FeedNotifier, FeedState>(
  () => FeedNotifier(FeedStore.following, true),
);
