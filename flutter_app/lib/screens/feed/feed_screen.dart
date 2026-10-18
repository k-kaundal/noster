import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/app_providers.dart';
import '../../widgets/post/post_card.dart';

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
    final notificationsAsync = ref.watch(notificationsProvider);
    final notifCount = notificationsAsync.valueOrNull?.length ?? 0;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.menu_rounded),
          tooltip: 'Menu',
          onPressed: () {
            HapticFeedback.lightImpact();
            Scaffold.of(context).openDrawer();
          },
        ),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [colorScheme.primary, colorScheme.tertiary],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(
                    color: colorScheme.primary.withValues(alpha: 0.3),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: const Icon(Icons.bolt_rounded, color: Colors.white, size: 18),
            ),
            const SizedBox(width: 10),
            const Text(
              'NostrFeed',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 20,
                letterSpacing: -0.5,
              ),
            ),
          ],
        ),
        actions: [
          // Search button
          IconButton(
            icon: const Icon(Icons.search_rounded),
            tooltip: 'Search',
            onPressed: () {
              HapticFeedback.lightImpact();
              context.push('/search');
            },
          ),
          // Notifications bell with badge
          IconButton(
            icon: Badge(
              isLabelVisible: notifCount > 0,
              label: Text(
                notifCount > 99 ? '99+' : '$notifCount',
                style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold),
              ),
              backgroundColor: colorScheme.error,
              textColor: colorScheme.onError,
              child: const Icon(Icons.notifications_outlined),
            ),
            tooltip: 'Notifications',
            onPressed: () {
              HapticFeedback.lightImpact();
              context.push('/notifications');
            },
          ),
          // Profile avatar
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
              child: CircleAvatar(
                radius: 16,
                backgroundColor: colorScheme.primaryContainer,
                backgroundImage: auth.profile?.picture != null
                    ? CachedNetworkImageProvider(auth.profile!.picture!)
                    : null,
                child: auth.profile?.picture == null
                    ? Icon(
                        Icons.person_rounded,
                        size: 18,
                        color: colorScheme.onPrimaryContainer,
                      )
                    : null,
              ),
            ),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'For You'),
            Tab(text: 'Following'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: const [
          _GlobalFeedTab(),
          _FollowingFeedTab(),
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
      loading: () => const _FeedSkeleton(),
      error: (error, _) => _ErrorView(
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
                const SizedBox(height: 120),
                Icon(emptyIcon, size: 64, color: Colors.grey),
                const SizedBox(height: 16),
                Text(
                  emptyMessage,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 16, color: Colors.grey),
                ),
                const SizedBox(height: 24),
                Center(
                  child: FilledButton.tonalIcon(
                    onPressed: onRefresh,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Refresh'),
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

// ─── Skeleton ───────────────────────────────────────────────────────

class _FeedSkeleton extends StatelessWidget {
  const _FeedSkeleton();

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: 6,
      itemBuilder: (context, index) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 22,
              backgroundColor: colorScheme.surfaceContainerHighest,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    height: 12,
                    width: 140,
                    decoration: BoxDecoration(
                      color: colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    height: 12,
                    decoration: BoxDecoration(
                      color: colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    height: 12,
                    width: 200,
                    decoration: BoxDecoration(
                      color: colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Error view ─────────────────────────────────────────────────────

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, size: 64, color: colorScheme.error),
            const SizedBox(height: 16),
            Text(
              'Connection Error',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(color: colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
