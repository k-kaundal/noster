import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:shimmer/shimmer.dart';
import '../../providers/app_providers.dart';
import '../../models/nostr_models.dart';

class TrendingScreen extends ConsumerStatefulWidget {
  const TrendingScreen({super.key});

  @override
  ConsumerState<TrendingScreen> createState() => _TrendingScreenState();
}

class _TrendingScreenState extends ConsumerState<TrendingScreen> {
  String _timeFilter = '24h';
  static const _filters = ['1h', '24h', '7d'];

  @override
  Widget build(BuildContext context) {
    final trending = ref.watch(trendingProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Trending'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: Row(
              children: _filters.map((f) {
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(f),
                    selected: _timeFilter == f,
                    onSelected: (_) => setState(() => _timeFilter = f),
                  ),
                );
              }).toList(),
            ),
          ),
        ),
      ),
      body: trending.when(
        loading: () => const _TrendingSkeleton(),
        error: (err, _) => _ErrorView(
          message: 'Failed to load trending posts',
          onRetry: () => ref.invalidate(trendingProvider),
        ),
        data: (events) {
          if (events.isEmpty) return const _EmptyTrending();
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(trendingProvider),
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: events.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, i) => _TrendingPostCard(
                event: events[i],
                rank: i + 1,
              ),
            ),
          );
        },
      ),
    );
  }
}

class _TrendingPostCard extends ConsumerWidget {
  final NostrEvent event;
  final int rank;
  const _TrendingPostCard({required this.event, required this.rank});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final timestamp =
        DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    // Placeholder engagement metrics
    final likes = 12 + (event.id.hashCode % 400).abs();
    final reposts = 3 + (event.id.hashCode % 60).abs();
    final replies = 1 + (event.id.hashCode % 30).abs();
    final zaps = (event.id.hashCode % 10000).abs();

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Rank badge
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: rank <= 3
                  ? scheme.primary.withValues(alpha: 0.15)
                  : scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Center(
              child: Text(
                '$rank',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                  color: rank <= 3 ? scheme.primary : scheme.onSurfaceVariant,
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    profileAsync.when(
                      data: (profile) => CircleAvatar(
                        radius: 14,
                        backgroundImage: profile?.picture != null
                            ? CachedNetworkImageProvider(profile!.picture!)
                            : null,
                        child: profile?.picture == null
                            ? const Icon(Icons.person, size: 14)
                            : null,
                      ),
                      loading: () => const CircleAvatar(radius: 14),
                      error: (_, _) =>
                          const CircleAvatar(radius: 14, child: Icon(Icons.person, size: 14)),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        profileAsync.value?.displayNameOrName ??
                            '${event.pubkey.substring(0, 8)}…',
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 13),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(
                      timeago.format(timestamp),
                      style: TextStyle(
                          fontSize: 11, color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  event.content,
                  maxLines: 4,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 14, height: 1.4),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _Metric(icon: Icons.favorite_border, count: likes),
                    const SizedBox(width: 16),
                    _Metric(icon: Icons.repeat, count: reposts),
                    const SizedBox(width: 16),
                    _Metric(icon: Icons.chat_bubble_outline, count: replies),
                    const SizedBox(width: 16),
                    _Metric(
                        icon: Icons.bolt,
                        count: zaps,
                        color: scheme.primary),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  final IconData icon;
  final int count;
  final Color? color;
  const _Metric({required this.icon, required this.count, this.color});

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.onSurfaceVariant;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: c),
        const SizedBox(width: 4),
        Text(
          _format(count),
          style: TextStyle(fontSize: 12, color: c),
        ),
      ],
    );
  }

  String _format(int n) {
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }
}

class _EmptyTrending extends StatelessWidget {
  const _EmptyTrending();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.trending_up, size: 64, color: scheme.primary),
          const SizedBox(height: 16),
          Text(
            'Nothing trending',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'Trending posts will appear here.',
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _TrendingSkeleton extends StatelessWidget {
  const _TrendingSkeleton();

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: 8,
      itemBuilder: (context, _) => Shimmer.fromColors(
        baseColor: base,
        highlightColor: Theme.of(context).colorScheme.surface,
        child: Padding(
          padding: const EdgeInsets.only(bottom: 20),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(width: 28, height: 28, color: Colors.white),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(height: 12, width: 140, color: Colors.white),
                    const SizedBox(height: 8),
                    Container(height: 12, color: Colors.white),
                    const SizedBox(height: 6),
                    Container(height: 12, width: 220, color: Colors.white),
                  ],
                ),
              ),
            ],
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
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.cloud_off, size: 56, color: scheme.error),
          const SizedBox(height: 16),
          Text(message, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
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
