import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import '../../providers/app_providers.dart';
import '../../widgets/post/post_card.dart';

class ExploreScreen extends ConsumerWidget {
  const ExploreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hashtagsAsync = ref.watch(trendingHashtagsProvider);
    final trending = ref.watch(trendingProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Explore'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => context.push('/search'),
            tooltip: 'Search',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(trendingHashtagsProvider);
          ref.invalidate(trendingProvider);
        },
        child: CustomScrollView(
          slivers: [
            // Trending hashtags
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Text(
                  'Trending Hashtags',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: hashtagsAsync.when(
                loading: () => const SizedBox(
                  height: 44,
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (_, _) => const SizedBox.shrink(),
                data: (stats) {
                  if (stats.isEmpty) return const SizedBox.shrink();
                  return SizedBox(
                    height: 44,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: stats.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 8),
                      itemBuilder: (context, i) {
                        final stat = stats[i];
                        return ActionChip(
                          avatar: const Icon(Icons.tag, size: 16),
                          label: Text('${stat.tag} (${stat.count})'),
                          onPressed: () =>
                              context.push('/hashtag/${Uri.encodeComponent(stat.tag)}'),
                        );
                      },
                    ),
                  );
                },
              ),
            ),

            // Trending posts
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
                child: Text(
                  'Trending Posts',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ),
            ),
            trending.when(
              loading: () => SliverToBoxAdapter(child: _PostsSkeleton()),
              error: (err, _) => SliverToBoxAdapter(
                child: _ErrorView(
                  message: 'Failed to load trending posts',
                  onRetry: () => ref.invalidate(trendingProvider),
                ),
              ),
              data: (events) {
                if (events.isEmpty) {
                  return const SliverToBoxAdapter(child: _EmptyTrending());
                }
                return SliverList.builder(
                  itemCount: events.length,
                  itemBuilder: (context, i) => PostCard(event: events[i]),
                );
              },
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        ),
      ),
    );
  }
}

class _EmptyTrending extends StatelessWidget {
  const _EmptyTrending();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        children: [
          Icon(Icons.explore_outlined, size: 56, color: scheme.primary),
          const SizedBox(height: 12),
          Text(
            'Nothing trending yet',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            'Check back soon for trending content.',
            style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

class _PostsSkeleton extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    return Shimmer.fromColors(
      baseColor: base,
      highlightColor: Theme.of(context).colorScheme.surface,
      child: Column(
        children: List.generate(
          5,
          (_) => ListTile(
            leading: const CircleAvatar(),
            title: Container(height: 12, color: Colors.white),
            subtitle: Container(height: 10, width: 120, color: Colors.white),
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        children: [
          Icon(Icons.cloud_off, size: 48, color: scheme.error),
          const SizedBox(height: 12),
          Text(message, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          FilledButton.tonalIcon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}
