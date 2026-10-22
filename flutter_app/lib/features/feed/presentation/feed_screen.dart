
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show ScrollCacheExtent;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/feed/application/feed_notifier.dart';
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
    _tabController = TabController(length: 2, vsync: this);
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
      body: Column(
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
                    ],
                  ),
                ),
                // Home AI shortcut — a compact ✨ chip right on the tab row,
                // next to the avatar (the shell AppBar button covers it too,
                // but this one sits inside the feed itself).
                if (aiAvailable)
                  Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: IconButton(
                      icon: Icon(
                        Icons.auto_awesome_rounded,
                        color: colorScheme.primary,
                      ),
                      tooltip: 'AI Assistant',
                      visualDensity: VisualDensity.compact,
                      onPressed: () {
                        HapticFeedback.lightImpact();
                        context.push('/ai');
                      },
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: GestureDetector(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      if (auth.isLoggedIn && auth.pubkey != null) {
                        context.push('/profile/${auth.pubkey}');
                      } else {
                        context.push('/login');
                      }
                    },
                    child: SafeAvatar(
                      imageUrl: auth.profile?.picture,
                      radius: 16,
                      backgroundColor: colorScheme.primaryContainer,
                      fallback: Icon(
                        Icons.person_rounded,
                        size: 18,
                        color: colorScheme.onPrimaryContainer,
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
                _FeedTab(following: false),
                _FeedTab(following: true),
              ],
            ),
          ),
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
                icon: const Icon(Icons.edit_rounded),
                label: const Text('Post'),
                elevation: 4,
              ),
            )
          : null,
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
    );
  }
}

// ─── One feed tab (offline-first, no flicker) ────────────────────────

class _FeedTab extends ConsumerStatefulWidget {
  final bool following;
  const _FeedTab({required this.following});

  @override
  ConsumerState<_FeedTab> createState() => _FeedTabState();
}

class _FeedTabState extends ConsumerState<_FeedTab>
    with AutomaticKeepAliveClientMixin {
  final _scrollController = ScrollController();

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    // Infinite scroll: start loading the next page near the bottom.
    if (_scrollController.position.pixels >
        _scrollController.position.maxScrollExtent - 800) {
      final notifier = widget.following
          ? ref.read(followingFeedNotifierProvider.notifier)
          : ref.read(globalFeedProvider.notifier);
      notifier.loadMore();
    }
  }

  NotifierProvider<FeedNotifier, FeedState> get _provider => widget.following
      ? followingFeedNotifierProvider
      : globalFeedProvider;

  /// The AI promo shows once in the "For You" feed (not Following), only when
  /// the feature is configured, after the first few posts so it isn't the
  /// very first thing a scroller sees.
  bool _showAiPromo(int eventCount) =>
      !widget.following &&
      ref.watch(aiAvailableProvider) &&
      eventCount > _aiPromoPosition;

  static const _aiPromoPosition = 3;

  int _aiPromoIndex(int eventCount) =>
      eventCount > _aiPromoPosition ? _aiPromoPosition : 0;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final feed = ref.watch(_provider);
    final auth = ref.watch(authStateProvider);

    // Following tab needs login.
    if (widget.following && !auth.isLoggedIn) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.people_outline, size: 64, color: Colors.grey),
              const SizedBox(height: 16),
              Text(
                'Log in to see posts from people you follow',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () => context.push('/login'),
                child: const Text('Log in'),
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(_provider.notifier).refresh(),
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
                : feed.events.isEmpty
                ? ListView(
                    key: const ValueKey('empty'),
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      SizedBox(
                        height: 400,
                        child: EmptyState(
                          icon: widget.following
                              ? Icons.people_outline
                              : Icons.feed_outlined,
                          title: feed.error != null
                              ? 'Could not load the feed — pull to retry'
                              : (widget.following
                                  ? 'No posts from people you follow yet'
                                  : 'No posts yet'),
                          iconColor: Colors.grey,
                          action: FilledButton.tonalIcon(
                            onPressed: () =>
                                ref.read(_provider.notifier).refresh(),
                            icon: const Icon(Icons.refresh),
                            label: const Text('Refresh'),
                          ),
                        ),
                      ),
                    ],
                  )
                : ListView.builder(
                    key: const ValueKey('feed'),
                    controller: _scrollController,
                    padding: const EdgeInsets.only(top: 4, bottom: 180),
                    // Build a little ahead of the viewport so media/cards are
                    // ready before they scroll in — smooths fast flings.
                    scrollCacheExtent: const ScrollCacheExtent.pixels(800),
                    itemCount:
                        feed.events.length +
                        (_showAiPromo(feed.events.length) ? 1 : 0) +
                        (feed.isLoadingMore ? 1 : 0),
                    itemBuilder: (context, index) {
                      final promoIndex = _aiPromoIndex(feed.events.length);
                      final showPromo = _showAiPromo(feed.events.length);

                      // The trailing "loading more" spinner is last.
                      if (index >=
                          feed.events.length + (showPromo ? 1 : 0)) {
                        return const Padding(
                          padding: EdgeInsets.all(24),
                          child: Center(
                            child: SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          ),
                        );
                      }
                      // The AI promo card sits a few posts down, once.
                      if (showPromo && index == promoIndex) {
                        return const _AiPromoCard();
                      }
                      final eventIndex =
                          showPromo && index > promoIndex ? index - 1 : index;
                      return PostCard(
                        // A stable key lets Flutter reuse the card's element +
                        // optimistic-like state as the list grows, instead of
                        // rebuilding every card from scratch on each page.
                        key: ValueKey(feed.events[eventIndex].id),
                        event: feed.events[eventIndex],
                      );
                    },
                  ),
          ),

          // Offline / error banner — a slim strip, not a replacement screen.
          if (feed.error != null && feed.events.isNotEmpty)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: _OfflineBanner(
                onRetry: () => ref.read(_provider.notifier).refresh(),
              ),
            ),

          // "N new posts" pill — live arrivals, folded in only on tap.
          if (feed.newCount > 0)
            Positioned(
              top: 12,
              left: 0,
              right: 0,
              child: Center(
                child: _NewPostsPill(
                  count: feed.newCount,
                  onTap: () {
                    ref.read(_provider.notifier).showNewPosts();
                    // Return to the top so the new posts are visible.
                    if (_scrollController.hasClients) {
                      _scrollController.animateTo(
                        0,
                        duration: const Duration(milliseconds: 350),
                        curve: Curves.easeOut,
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
  final VoidCallback onRetry;
  const _OfflineBanner({required this.onRetry});

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
              Icon(Icons.cloud_off_rounded,
                  size: 16, color: scheme.onErrorContainer),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'You\'re offline — showing saved posts',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: scheme.onErrorContainer,
                  ),
                ),
              ),
              Icon(Icons.refresh_rounded,
                  size: 16, color: scheme.onErrorContainer),
            ],
          ),
        ),
      ),
    );
  }
}

/// The "N new posts" pill — tap to fold the live arrivals into the feed.
class _NewPostsPill extends StatelessWidget {
  final int count;
  final VoidCallback onTap;
  const _NewPostsPill({required this.count, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.primary,
      borderRadius: BorderRadius.circular(20),
      elevation: 4,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.arrow_upward_rounded,
                  size: 16, color: Colors.white),
              const SizedBox(width: 6),
              Text(
                '$count new post${count == 1 ? '' : 's'}',
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
    );
  }
}

/// In-feed discovery card for the AI assistant — a branded gradient tile
/// slipped into the For You feed once, so the flagship feature finds users
/// who never open the drawer.
class _AiPromoCard extends ConsumerWidget {
  const _AiPromoCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final trialLeft = ref.watch(aiTrialRemainingProvider);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Material(
        borderRadius: BorderRadius.circular(20),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () {
            HapticFeedback.lightImpact();
            context.push('/ai');
          },
          child: Ink(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [scheme.primary, scheme.tertiary],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.auto_awesome_rounded,
                      color: Colors.white,
                      size: 26,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Ask NostrFeed AI',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            letterSpacing: -0.2,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          trialLeft > 0
                              ? '$trialLeft free messages today — summarize '
                                  'threads, draft posts, generate images'
                              : 'Summarize threads, draft posts, generate '
                                  'images — pay per message in sats',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.9),
                            fontSize: 12.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(
                    Icons.arrow_forward_rounded,
                    color: Colors.white,
                    size: 20,
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
