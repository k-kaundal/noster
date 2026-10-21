import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/feed/widgets/post_card.dart';

class ExploreScreen extends ConsumerWidget {
  const ExploreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hashtagsAsync = ref.watch(trendingHashtagsProvider);
    // Default to 24h for explore page trending posts
    final trending = ref.watch(trendingProvider(24));

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
          ref.invalidate(trendingProvider(24));
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
                  if (stats.isEmpty) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Text(
                        'No trending hashtags right now',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                          fontSize: 13,
                        ),
                      ),
                    );
                  }
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
                          onPressed: () => context.push(
                              '/hashtag/${Uri.encodeComponent(stat.tag)}'),
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
                child: Row(
                  children: [
                    Text(
                      'Trending Posts',
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),
                    const Spacer(),
                    TextButton(
                      onPressed: () => context.push('/trending'),
                      child: const Text('See all'),
                    ),
                  ],
                ),
              ),
            ),
            trending.when(
              loading: () => const SliverToBoxAdapter(
                child: SizedBox(height: 300, child: SkeletonList(itemCount: 3)),
              ),
              error: (err, _) => SliverToBoxAdapter(
                child: ErrorView(
                  message: 'Failed to load trending posts',
                  onRetry: () => ref.invalidate(trendingProvider(24)),
                ),
              ),
              data: (events) {
                if (events.isEmpty) {
                  return const SliverToBoxAdapter(
                    child: EmptyState(
                      icon: Icons.explore_outlined,
                      title: 'Nothing trending yet',
                      subtitle: 'Check back soon for trending content.',
                    ),
                  );
                }
                return SliverList.builder(
                  itemCount: events.length > 10 ? 10 : events.length,
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
