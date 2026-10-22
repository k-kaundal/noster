import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/post_card.dart';

class TrendingScreen extends ConsumerStatefulWidget {
  const TrendingScreen({super.key});

  @override
  ConsumerState<TrendingScreen> createState() => _TrendingScreenState();
}

class _TrendingScreenState extends ConsumerState<TrendingScreen> {
  int _selectedHours = 24;
  static const _filters = [
    (hours: 1, label: '1h'),
    (hours: 24, label: '24h'),
    (hours: 168, label: '7d'),
  ];

  @override
  Widget build(BuildContext context) {
    final trending = ref.watch(trendingProvider(_selectedHours));

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
                    label: Text(f.label),
                    selected: _selectedHours == f.hours,
                    onSelected: (_) => setState(() => _selectedHours = f.hours),
                  ),
                );
              }).toList(),
            ),
          ),
        ),
      ),
      body: trending.when(
        loading: () => const SkeletonList(),
        error: (err, _) => ErrorView(
          message: 'Failed to load trending posts',
          onRetry: () => ref.invalidate(trendingProvider(_selectedHours)),
        ),
        data: (events) {
          if (events.isEmpty) {
            return const EmptyState(
              icon: Icons.trending_up,
              title: 'Nothing trending',
              subtitle: 'Trending posts will appear here.',
            );
          }
          return RefreshIndicator(
            onRefresh: () async =>
                ref.invalidate(trendingProvider(_selectedHours)),
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

class _TrendingPostCard extends StatelessWidget {
  final NostrEvent event;
  final int rank;
  const _TrendingPostCard({required this.event, required this.rank});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Rank badge
        Padding(
          padding: const EdgeInsets.only(left: 16, top: 14),
          child: Container(
            width: 26,
            height: 26,
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
                  fontSize: 12,
                  color: rank <= 3 ? scheme.primary : scheme.onSurfaceVariant,
                ),
              ),
            ),
          ),
        ),
        // PostCard already includes reply/repost/like/zap/bookmark/share
        // action buttons — no extra stats bar needed.
        Expanded(child: PostCard(event: event)),
      ],
    );
  }
}
