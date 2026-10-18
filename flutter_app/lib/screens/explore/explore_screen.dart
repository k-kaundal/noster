import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:shimmer/shimmer.dart';
import '../../providers/app_providers.dart';
import '../../models/nostr_models.dart';

class ExploreScreen extends ConsumerWidget {
  const ExploreScreen({super.key});

  static const _trendingTags = [
    'bitcoin', 'nostr', 'lightning', 'privacy', 'photography', 'music', 'art'
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trending = ref.watch(trendingProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Explore'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () {},
            tooltip: 'Search',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(trendingProvider),
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
              child: SizedBox(
                height: 44,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: _trendingTags.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (context, i) => ActionChip(
                    avatar: const Icon(Icons.tag, size: 16),
                    label: Text(_trendingTags[i]),
                    onPressed: () {},
                  ),
                ),
              ),
            ),

            // Suggested users
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
                child: Text(
                  'Suggested Users',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: SizedBox(
                height: 150,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: 8,
                  separatorBuilder: (_, _) => const SizedBox(width: 10),
                  itemBuilder: (context, i) => _SuggestedUserCard(index: i),
                ),
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
                return SliverList.separated(
                  itemCount: events.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 4),
                  itemBuilder: (context, i) =>
                      _TrendingPostTile(event: events[i]),
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

class _SuggestedUserCard extends StatelessWidget {
  final int index;
  const _SuggestedUserCard({required this.index});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 24,
              backgroundColor: scheme.primaryContainer,
              child: Icon(Icons.person, color: scheme.onPrimaryContainer),
            ),
            const SizedBox(height: 8),
            Text(
              'Nostr User',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 6),
            SizedBox(
              height: 26,
              child: FilledButton.tonal(
                onPressed: () {},
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  minimumSize: Size.zero,
                ),
                child: const Text('Follow', style: TextStyle(fontSize: 11)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TrendingPostTile extends ConsumerWidget {
  final NostrEvent event;
  const _TrendingPostTile({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final timestamp =
        DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: profileAsync.when(
        data: (profile) => CircleAvatar(
          backgroundImage: profile?.picture != null
              ? CachedNetworkImageProvider(profile!.picture!)
              : null,
          child: profile?.picture == null ? const Icon(Icons.person) : null,
        ),
        loading: () => const CircleAvatar(),
        error: (_, _) => const CircleAvatar(child: Icon(Icons.person)),
      ),
      title: Text(
        event.content,
        maxLines: 3,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 14),
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Row(
          children: [
            Text(
              profileAsync.value?.displayNameOrName ?? 'Anon',
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(width: 8),
            Text(
              timeago.format(timestamp),
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
      onTap: () {},
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
