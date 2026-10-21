import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/feed/widgets/post_card.dart';

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

    // AppBar is owned by AppShell (drawer lives there). The feed screen
    // provides only its body: a slim sub-header with the For You / Following
    // tabs + quick actions, then the feed itself.
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
                // Profile avatar (search + notifications live in the AppBar)
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
                _GlobalFeedTab(),
                _FollowingFeedTab(),
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

// ─── Global / For You feed ───────────────────────────────────────────

class _GlobalFeedTab extends ConsumerWidget {
  const _GlobalFeedTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedAsync = ref.watch(feedProvider);
    return _FeedBody(
      feedAsync: feedAsync,
      onRefresh: () => ref.invalidate(feedProvider),
      emptyMessage: 'No posts found',
      emptyIcon: Icons.feed_outlined,
    );
  }
}

// ─── Following feed ─────────────────────────────────────────────────

class _FollowingFeedTab extends ConsumerWidget {
  const _FollowingFeedTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedAsync = ref.watch(followingFeedProvider);
    final auth = ref.watch(authStateProvider);

    if (!auth.isLoggedIn) {
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

    return _FeedBody(
      feedAsync: feedAsync,
      onRefresh: () => ref.invalidate(followingFeedProvider),
      emptyMessage: 'No posts from people you follow yet',
      emptyIcon: Icons.people_outline,
    );
  }
}

// ─── Shared feed body ───────────────────────────────────────────────

class _FeedBody extends ConsumerWidget {
  final AsyncValue<List<dynamic>> feedAsync;
  final VoidCallback onRefresh;
  final String emptyMessage;
  final IconData emptyIcon;

  const _FeedBody({
    required this.feedAsync,
    required this.onRefresh,
    required this.emptyMessage,
    required this.emptyIcon,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return feedAsync.when(
      loading: () => const SkeletonList(),
      error: (error, _) => ErrorView(
        message: 'Could not load feed. Check your connection.',
        onRetry: onRefresh,
      ),
      data: (events) {
        if (events.isEmpty) {
          return RefreshIndicator(
            onRefresh: () async => onRefresh(),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                SizedBox(
                  height: 400,
                  child: EmptyState(
                    icon: emptyIcon,
                    title: emptyMessage,
                    iconColor: Colors.grey,
                    action: FilledButton.tonalIcon(
                      onPressed: onRefresh,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Refresh'),
                    ),
                  ),
                ),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: () async => onRefresh(),
          child: ListView.builder(
            padding: const EdgeInsets.only(top: 4, bottom: 180), // Space for FAB + bottom nav
            itemCount: events.length,
            itemBuilder: (context, index) =>
                PostCard(event: events[index] as dynamic),
          ),
        );
      },
    );
  }
}
