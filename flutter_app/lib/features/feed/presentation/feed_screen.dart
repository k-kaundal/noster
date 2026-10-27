import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show ScrollCacheExtent;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/moderation/content_filter.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/providers/connectivity_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/feed/application/feed_notifier.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/ai_feed_bar.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/note_content.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/post_card.dart';

class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key});

  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends ConsumerState<FeedScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    // Three tabs: For You (personalized) | Following | Global (firehose).
    // For You is FIRST — it's the default home (personalized like FB/X),
    // Global is the unfiltered everything-feed (the old For You).
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider);
    final colorScheme = Theme.of(context).colorScheme;
    final aiAvailable = ref.watch(aiAvailableProvider);

    return Scaffold(
      body: Stack(
        children: [
          Column(
            children: [
              Material(
                color: colorScheme.surface,
                child: Row(
                  children: [
                    Expanded(
                      child: TabBar(
                        controller: _tabController,
                        tabs: const [
                          Tab(text: 'For You'),
                          Tab(text: 'Following'),
                          Tab(text: 'Global'),
                        ],
                      ),
                    ),
                    // Home AI shortcut — a LABELED "✨ AI" pill on the tab
                    // row, not a bare icon: users must SEE it's a tappable AI
                    // link (a lone sparkle read as decoration). Quiet pill in
                    // the accent container, clearly a button.
                    if (aiAvailable)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: Semantics(
                          button: true,
                          label: 'Open AI assistant',
                          child: Material(
                            color: colorScheme.primaryContainer,
                            borderRadius: BorderRadius.circular(18),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(18),
                              onTap: () {
                                HapticFeedback.lightImpact();
                                context.push('/ai');
                              },
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 7,
                                ),
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(18),
                                  border: Border.all(
                                    color: colorScheme.primary.withValues(
                                      alpha: 0.4,
                                    ),
                                  ),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    AppIcon(
                                      'sparkle',
                                      size: AppIconSize.md,
                                      color: colorScheme.primary,
                                    ),
                                    const SizedBox(width: 5),
                                    Text(
                                      'Ask AI',
                                      style: Theme.of(context)
                                          .textTheme
                                          .labelLarge
                                          ?.copyWith(
                                            color: colorScheme.primary,
                                            fontWeight: FontWeight.w700,
                                          ),
                                    ),
                                    const SizedBox(width: 3),
                                    AppIcon(
                                      'chevron_r',
                                      size: AppIconSize.xs,
                                      color: colorScheme.primary.withValues(
                                        alpha: 0.7,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              Expanded(
                child: TabBarView(
                  controller: _tabController,
                  children: const [
                    _FeedTab(mode: FeedMode.forYou),
                    _FeedTab(mode: FeedMode.following),
                    _FeedTab(mode: FeedMode.global),
                  ],
                ),
              ),
            ],
          ),
          // Support side shortcut — a small edge tab on the LEFT, vertically
          // centered, that opens the Support page. Semi-quiet so it never
          // competes with the feed; dismissible (one tap hides it for the
          // session).
          const _SupportSideShortcut(),
        ],
      ),
      floatingActionButton: auth.isLoggedIn && !auth.isReadOnly
          ? Padding(
              padding: const EdgeInsets.only(bottom: 90),
              child: FloatingActionButton.extended(
                onPressed: () {
                  HapticFeedback.mediumImpact();
                  context.push('/compose');
                },
                icon: const AppIcon('edit'),
                label: const Text('Post'),
                elevation: 4,
              ),
            )
          : null,
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
    );
  }
}

// ─── Support side shortcut (left-center edge tab) ────────────────────

/// A small vertical edge tab on the LEFT side of the feed, vertically
/// centered, that opens `/support`. Semi-transparent + hairline so it never
/// competes with the posts; one tap on the × hides it for the session (the
/// /you row still reaches the page).
class _SupportSideShortcut extends StatefulWidget {
  const _SupportSideShortcut();

  @override
  State<_SupportSideShortcut> createState() => _SupportSideShortcutState();
}

class _SupportSideShortcutState extends State<_SupportSideShortcut> {
  bool _hidden = false;

  @override
  Widget build(BuildContext context) {
    if (_hidden) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    final top = MediaQuery.sizeOf(context).height * 0.42;

    return Positioned(
      left: 0,
      top: top,
      child: Semantics(
        button: true,
        label: 'Support NostrFeed',
        child: Material(
          color: scheme.surfaceContainerHigh.withValues(alpha: 0.92),
          borderRadius: const BorderRadius.horizontal(
            right: Radius.circular(14),
          ),
          elevation: 2,
          child: InkWell(
            borderRadius: const BorderRadius.horizontal(
              right: Radius.circular(14),
            ),
            onTap: () {
              HapticFeedback.lightImpact();
              context.push('/support');
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
              decoration: BoxDecoration(
                borderRadius: const BorderRadius.horizontal(
                  right: Radius.circular(14),
                ),
                border: Border(
                  top: BorderSide(color: scheme.outlineVariant, width: 0.5),
                  right: BorderSide(color: scheme.outlineVariant, width: 0.5),
                  bottom: BorderSide(color: scheme.outlineVariant, width: 0.5),
                ),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AppIcon(
                    'zap',
                    size: AppIconSize.md,
                    color: AppActionColors.zapFor(scheme.brightness),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Support',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: scheme.onSurfaceVariant,
                      fontSize: 10,
                    ),
                  ),
                  const SizedBox(height: 4),
                  GestureDetector(
                    onTap: () => setState(() => _hidden = true),
                    child: Padding(
                      padding: const EdgeInsets.all(2),
                      child: AppIcon(
                        'back',
                        size: 10,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── One feed tab (offline-first, no flicker) ────────────────────────

class _FeedTab extends ConsumerStatefulWidget {
  final FeedMode mode;
  const _FeedTab({required this.mode});

  bool get following => mode == FeedMode.following;

  @override
  ConsumerState<_FeedTab> createState() => _FeedTabState();
}

class _FeedTabState extends ConsumerState<_FeedTab>
    with AutomaticKeepAliveClientMixin {
  final _scrollController = ScrollController();

  /// Scroll-driven image prefetch (R7, Amethyst PR #3325 pattern): warm the
  /// next few items' images OFF-SCREEN so they decode before scrolling in,
  /// instead of mid-frame during a fast fling. Debounced 150 ms, triggers
  /// every ~5 items of movement, bounded to a small lookahead window.
  Timer? _prefetchDebounce;
  int _lastPrefetchIndex = -1;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _prefetchDebounce?.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    // Guard against degenerate layouts (maxScrollExtent 0 or negative — an
    // Android quirk during the first frames / keyboard open) that made the
    // threshold negative and spammed loadMore, locking the scroll thread.
    if (pos.maxScrollExtent <= 0) return;
    // Infinite scroll: start loading the next page near the bottom. Clamp
    // the trigger so Android's clamping overscroll (pixels can exceed
    // maxScrollExtent during an over-fling) can't re-fire it mid-load.
    if (pos.pixels > pos.maxScrollExtent - 800 &&
        pos.pixels <= pos.maxScrollExtent + 1) {
      ref.read(_provider.notifier).loadMore();
    }
    _schedulePrefetch();
  }

  /// Estimate the first visible item from the scroll offset and prefetch the
  /// images of the next [_prefetchAhead] items. Debounced so a fling warms
  /// once at the end instead of 60× during it.
  void _schedulePrefetch() {
    _prefetchDebounce?.cancel();
    _prefetchDebounce = Timer(const Duration(milliseconds: 150), _prefetch);
  }

  /// Average feed card height used to estimate the visible index from the
  /// scroll offset. Cards are variable-height, so this is approximate —
  /// prefetch is a warm-up, not a correctness path, so an off-by-a-few
  /// window is fine.
  static const _avgCardExtent = 320.0;

  /// How many items past the (estimated) first visible one to warm.
  static const _prefetchAhead = 6;

  void _prefetch() {
    if (!mounted || !_scrollController.hasClients) return;
    final events = ref.read(_provider).events;
    if (events.isEmpty) return;
    final firstVisible = (_scrollController.offset / _avgCardExtent)
        .floor()
        .clamp(0, events.length - 1);
    // Only do the work when we've moved ~5+ items since the last warm —
    // avoids re-walking the same window on small scrolls.
    if ((firstVisible - _lastPrefetchIndex).abs() < 5) return;
    _lastPrefetchIndex = firstVisible;

    final urls = <String>[];
    final end = (firstVisible + _prefetchAhead).clamp(0, events.length);
    for (var i = firstVisible; i < end; i++) {
      for (final url in NoteParseCache.imagesFor(events[i])) {
        urls.add(NoteParseCache.feedTileUrl(url));
        if (urls.length >= 12) break; // bound per warm (see header note)
      }
      if (urls.length >= 12) break;
    }
    for (final url in urls) {
      // precacheImage puts the decoded bitmap in the image cache keyed by
      // the URL — the SAME resized URL the feed tile requests, so the tile
      // hits a warm cache instead of decoding mid-frame. Errors are
      // swallowed: a failed warm just means the tile loads (and self-heals)
      // normally.
      unawaited(
        precacheImage(
          CachedNetworkImageProvider(url, headers: kImageHttpHeaders),
          context,
          onError: (_, _) {},
        ),
      );
    }
  }

  NotifierProvider<FeedNotifier, FeedState> get _provider =>
      switch (widget.mode) {
        FeedMode.global => globalFeedProvider,
        FeedMode.forYou => forYouFeedProvider,
        FeedMode.following => followingFeedNotifierProvider,
      };

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final feed = ref.watch(_provider);
    final auth = ref.watch(authStateProvider);

    // Following tab needs login.
    if (widget.following && !auth.isLoggedIn) {
      return Center(
        child: EmptyState(
          icon: Icons.people_outline,
          title: 'Log in to see posts from people you follow',
          iconColor: Colors.grey,
          action: FilledButton(
            onPressed: () => context.push('/login'),
            child: const Text('Log in'),
          ),
        ),
      );
    }

    return RefreshIndicator(
      // refreshFromPull clears any stuck refresh flag from a prior hung
      // fetch first, so a pull ALWAYS gets a fresh attempt (never blocked).
      onRefresh: () => ref.read(_provider.notifier).refreshFromPull(),
      child: Stack(
        children: [
          // Skeleton → content cross-fade (ADR-0003): the first load is the
          // only time a skeleton shows (disk cache covers the rest), and it
          // fades into the posts rather than being yanked out.
          AnimatedSwitcher(
            duration: AppMotion.normal,
            switchInCurve: AppMotion.curve,
            switchOutCurve: AppMotion.curve,
            child: feed.events.isEmpty && feed.isRefreshing
                ? const SkeletonList(key: ValueKey('skeleton'))
                : feed.events.isEmpty && widget.following
                ? _FollowingEmptyState(
                    feed: feed,
                    onRefresh: () => ref.read(_provider.notifier).refresh(),
                  )
                : feed.events.isEmpty
                ? ListView(
                    key: const ValueKey('empty'),
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      SizedBox(
                        height: 420,
                        child: EmptyState(
                          icon: Icons.feed_outlined,
                          title: feed.error != null
                              ? 'Could not load the feed — pull to retry'
                              : 'No posts yet',
                          iconColor: Colors.grey,
                          action: feed.error != null
                              ? FilledButton.tonalIcon(
                                  onPressed: () =>
                                      ref.read(_provider.notifier).refresh(),
                                  icon: const AppIcon('repost'),
                                  label: const Text('Refresh'),
                                )
                              : FilledButton.tonalIcon(
                                  onPressed: () =>
                                      ref.read(_provider.notifier).refresh(),
                                  icon: const AppIcon('repost'),
                                  label: const Text('Refresh'),
                                ),
                        ),
                      ),
                    ],
                  )
                : Builder(
                    builder: (context) {
                      // +1 for the AI bar pinned at the top of the For You
                      // tab (never in Following or Global — a feature entry
                      // point, not a promo card; see AiFeedBar).
                      final hasAiBar = widget.mode == FeedMode.forYou;
                      return ListView.builder(
                        key: const ValueKey('feed'),
                        controller: _scrollController,
                        padding: const EdgeInsets.only(top: 4, bottom: 180),
                        // Always-scrollable so pull-to-refresh works even on a
                        // short feed; bouncing on iOS, clamping on Android —
                        // the platform default reads naturally on each.
                        // Explicit physics avoids the "scroll gets stuck"
                        // Android quirk where an unset physics + heavy cards
                        // lock the thread.
                        physics: const AlwaysScrollableScrollPhysics(),
                        // Build a little ahead of the viewport so media/cards
                        // are ready before they scroll in — smooths flings.
                        scrollCacheExtent: const ScrollCacheExtent.pixels(800),
                        itemCount:
                            feed.events.length +
                            (hasAiBar ? 1 : 0) +
                            (feed.isLoadingMore ? 1 : 0),
                        itemBuilder: (context, index) {
                          if (hasAiBar && index == 0) {
                            return const AiFeedBar();
                          }
                          final postIndex = hasAiBar ? index - 1 : index;
                          // The trailing "loading more" spinner is last.
                          if (postIndex >= feed.events.length) {
                            return const Padding(
                              padding: EdgeInsets.all(24),
                              child: Center(
                                child: SizedBox(
                                  width: 22,
                                  height: 22,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                ),
                              ),
                            );
                          }
                          return PostCard(
                            // A stable key lets Flutter reuse the card's
                            // element + optimistic-like state as the list
                            // grows, instead of rebuilding every card from
                            // scratch on each page.
                            key: ValueKey(feed.events[postIndex].id),
                            event: feed.events[postIndex],
                          );
                        },
                      );
                    },
                  ),
          ),

          // Offline / error banner — a slim strip, not a replacement screen.
          // Shows "offline" ONLY when connectivity actually reports offline;
          // an online-but-failed refresh (relays unreachable from the
          // emulator/network) gets an honest "couldn't refresh" message
          // instead of a wrong "you're offline" (the banner-stuck bug).
          if (feed.error != null && feed.events.isNotEmpty)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: _OfflineBanner(
                offline: ref.watch(isOfflineProvider),
                onRetry: () => ref.read(_provider.notifier).refresh(),
              ),
            ),

          // "N new posts" pill — live arrivals, folded in only on tap.
          // Shown on ALL THREE tabs (For You / Following / Global): each
          // tab's notifier has its own live tail + pending buffer, so a new
          // post pops the pill on whichever tab is live. For You re-ranks
          // the pending batch with personalization before merging.
          if (feed.newCount > 0)
            Positioned(
              top: 12,
              left: 0,
              right: 0,
              child: Center(
                child: _NewPostsPill(
                  count: feed.newCount,
                  authorPubkeys: feed.newPostAuthors,
                  onTap: () {
                    HapticFeedback.lightImpact();
                    ref.read(_provider.notifier).showNewPosts();
                    // Return to the top so the new posts are visible.
                    if (_scrollController.hasClients) {
                      _scrollController.animateTo(
                        0,
                        duration: AppMotion.normal,
                        curve: AppMotion.curve,
                      );
                    }
                  },
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Slim offline/error strip at the top — the feed behind it stays usable.
class _OfflineBanner extends StatelessWidget {
  final bool offline;
  final VoidCallback onRetry;
  const _OfflineBanner({required this.offline, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.errorContainer,
      child: InkWell(
        onTap: onRetry,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              AppIcon(
                offline ? 'wifi_off' : 'repost',
                size: AppIconSize.sm,
                color: scheme.onErrorContainer,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  // Honest message: "offline" only when connectivity says so,
                  // otherwise the refresh just failed (relays unreachable).
                  offline
                      ? 'You\'re offline — showing saved posts'
                      : 'Couldn\'t refresh — tap to retry',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: scheme.onErrorContainer,
                  ),
                ),
              ),
              AppIcon('repost', size: 16, color: scheme.onErrorContainer),
            ],
          ),
        ),
      ),
    );
  }
}

/// The "N new posts" pill — tap to fold the live arrivals into the feed.
///
/// Primal's NewPostsButton: a primary pill with up to 3 stacked author
/// avatars + an accurate count capped at "20+". The avatar pictures resolve
/// from the shared `profileProvider` cache (the live tail's authors were
/// prefetched with their page — no extra relay queries per pill).
class _NewPostsPill extends StatelessWidget {
  final int count;
  final List<String> authorPubkeys;
  final VoidCallback onTap;
  const _NewPostsPill({
    required this.count,
    required this.authorPubkeys,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      label: 'Show $count new posts',
      child: Material(
        color: scheme.primary,
        borderRadius: BorderRadius.circular(20),
        elevation: 4,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (authorPubkeys.isNotEmpty) ...[
                  _AvatarStack(pubkeys: authorPubkeys),
                  const SizedBox(width: 8),
                ] else ...[
                  const AppIcon('arrow_up', size: 16, color: Colors.white),
                  const SizedBox(width: 6),
                ],
                Text(
                  count > 20
                      ? '20+ new posts'
                      : '$count new post${count == 1 ? '' : 's'}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Up to 3 overlapping author avatars — each resolves its picture from the
/// shared profile cache (no extra fetches).
class _AvatarStack extends ConsumerWidget {
  final List<String> pubkeys;
  const _AvatarStack({required this.pubkeys});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    const size = 22.0;
    const overlap = 14.0;
    final shown = pubkeys.take(3).toList();
    return SizedBox(
      width: size + (shown.length - 1) * overlap,
      height: size,
      child: Stack(
        children: [
          for (var i = 0; i < shown.length; i++)
            Positioned(
              left: i * overlap,
              child: Container(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: scheme.primary, width: 1.5),
                ),
                child: SafeAvatar(
                  imageUrl: ref
                      .watch(profileProvider(shown[i]))
                      .valueOrNull
                      ?.picture,
                  radius: size / 2 - 1.5,
                  backgroundColor: scheme.primaryContainer,
                  fallback: Icon(
                    Icons.person_rounded,
                    size: 12,
                    color: scheme.onPrimaryContainer,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The Following tab's empty state: shows "Your feed is quiet" + a list of
/// trending authors worth following (People to follow). Never a dead end —
/// the user can tap a profile and follow them, filling their feed.
class _FollowingEmptyState extends ConsumerWidget {
  final FeedState feed;
  final VoidCallback onRefresh;

  const _FollowingEmptyState({required this.feed, required this.onRefresh});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final auth = ref.watch(authStateProvider);

    // Proper per-user context: does this user actually follow anyone? The
    // empty state's job changes by answer — a user with ZERO follows needs
    // "discover people"; a user WITH follows but no posts yet needs "pull
    // to refresh" (the hub may just not have synced their authors yet —
    // telling them to follow MORE people is the wrong nudge).
    final follows = ref.watch(followsProvider).valueOrNull;
    final followCount = follows?.length ?? 0;

    return ListView(
      key: const ValueKey('following-empty'),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        // NO fixed-height SizedBox — the EmptyState sizes itself (the 200px
        // box OVERFLOWED the column: icon + title + subtitle + retry button
        // ≈ 220px, flagged by DevTools as a RenderFlex overflow).
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 40),
          child: EmptyState(
            icon: Icons.people_outline,
            title: feed.error != null
                ? 'Could not load the feed — pull to retry'
                : followCount == 0
                ? 'Your feed is quiet'
                : 'No posts from people you follow yet',
            subtitle: feed.error != null
                ? null
                : followCount == 0
                ? 'Follow some people and their posts show up here.'
                : 'You follow $followCount ${followCount == 1 ? 'person' : 'people'} — their posts appear here as they arrive.',
            iconColor: Colors.grey,
            action: feed.error != null || followCount > 0
                ? FilledButton.tonalIcon(
                    onPressed: onRefresh,
                    icon: const AppIcon('repost'),
                    label: const Text('Refresh'),
                  )
                : FilledButton.tonalIcon(
                    onPressed: () => context.go('/explore'),
                    icon: const AppIcon('sparkle'),
                    label: const Text('Discover people'),
                  ),
          ),
        ),
        // People to follow — only when the user follows nobody (a user who
        // already follows people doesn't need discovery pushed at them).
        if (feed.error == null && auth.isLoggedIn && followCount == 0) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Text(
              'PEOPLE TO FOLLOW',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                fontWeight: FontWeight.w700,
                color: colorScheme.primary,
                letterSpacing: 1.2,
              ),
            ),
          ),
          const _FollowingPeopleToFollow(),
        ],
      ],
    );
  }
}

/// Trending authors worth following: the authors of trending posts in the
/// global feed, deduplicated, profiles checked against the content filter.
/// Same source as Explore's People-to-follow (trendingProvider).
class _FollowingPeopleToFollow extends ConsumerWidget {
  const _FollowingPeopleToFollow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trending = ref.watch(trendingProvider(24)).valueOrNull ?? [];
    final follows = ref.watch(followsProvider).valueOrNull ?? [];
    final auth = ref.watch(authStateProvider);

    // Authors of trending posts, most-posting first, excluding self/follows.
    final counts = <String, int>{};
    for (final e in trending) {
      counts[e.pubkey] = (counts[e.pubkey] ?? 0) + 1;
    }
    final candidates = counts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final pubkeys = candidates
        .map((e) => e.key)
        .where((pk) => pk != auth.pubkey && !follows.contains(pk))
        .take(8)
        .toList();

    if (pubkeys.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Text(
          'No suggestions right now — check back soon.',
          style: Theme.of(context).textTheme.bodySmall
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      );
    }

    return SizedBox(
      height: 176,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: pubkeys.length,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (context, i) => _FollowPersonCard(pubkey: pubkeys[i]),
      ),
    );
  }
}

/// A person card in the "People to follow" list — avatar, name, NIP-05,
/// and a View button that opens their profile.
class _FollowPersonCard extends ConsumerWidget {
  final String pubkey;
  const _FollowPersonCard({required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(pubkey));
    final profile = profileAsync.valueOrNull;

    // Filtered profiles don't get recommended.
    final filter = ref.watch(contentFilterProvider);
    if (filter.verdictForProfile(profile, pubkey).action != FilterAction.show) {
      return const SizedBox.shrink();
    }

    final name = profile?.displayNameOrName ?? '${pubkey.substring(0, 8)}…';
    final textTheme = Theme.of(context).textTheme;

    return Container(
      width: 132,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          SafeAvatar(
            imageUrl: profile?.picture,
            radius: 26,
            fallback: Text(
              firstGrapheme(name),
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
          ),
          if (profile?.nip05 != null && profile!.nip05!.isNotEmpty)
            Text(
              profile.nip05!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: textTheme.labelSmall?.copyWith(color: scheme.primary),
            ),
          const Spacer(),
          SizedBox(
            width: double.infinity,
            child: FilledButton.tonal(
              onPressed: () => context.push('/profile/$pubkey'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 4),
                minimumSize: const Size(0, 30),
              ),
              child: Text('View', style: textTheme.labelMedium),
            ),
          ),
        ],
      ),
    );
  }
}
