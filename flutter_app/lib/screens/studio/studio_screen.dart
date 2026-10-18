import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../../providers/app_providers.dart';
import '../../models/nostr_models.dart';

class StudioScreen extends ConsumerWidget {
  const StudioScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);
    final feed = ref.watch(feedProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Creator Studio'),
        actions: [
          IconButton(
            icon: const Icon(Icons.analytics_outlined),
            onPressed: () {},
            tooltip: 'Analytics',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(feedProvider),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Stats grid
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: 2.2,
              children: [
                _StatCard(
                  icon: Icons.article_outlined,
                  label: 'Posts',
                  value: '128',
                  delta: '+12 this week',
                ),
                _StatCard(
                  icon: Icons.bolt,
                  label: 'Zaps received',
                  value: '4.2k sats',
                  delta: '+340 today',
                  iconColor: Colors.amber,
                ),
                _StatCard(
                  icon: Icons.people_outline,
                  label: 'Followers',
                  value: '1,248',
                  delta: '+23 this week',
                ),
                _StatCard(
                  icon: Icons.favorite_outline,
                  label: 'Engagement',
                  value: '8.4%',
                  delta: '+1.2% this week',
                ),
              ],
            ),
            const SizedBox(height: 24),

            // Earnings chart placeholder
            Text(
              'Earnings (30 days)',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10),
            _EarningsChart(),
            const SizedBox(height: 24),

            // Recent activity
            Text(
              'Recent Activity',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10),
            feed.when(
              loading: () => const _ActivitySkeleton(),
              error: (_, _) => const _ActivityError(),
              data: (events) {
                if (events.isEmpty) {
                  return const _ActivityEmpty();
                }
                final myPosts = auth.pubkey != null
                    ? events
                        .where((e) => e.pubkey == auth.pubkey)
                        .take(5)
                        .toList()
                    : events.take(5).toList();
                return Column(
                  children: myPosts
                      .map((e) => _ActivityTile(event: e))
                      .toList(),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String delta;
  final Color? iconColor;

  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.delta,
    this.iconColor,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon,
                  size: 20,
                  color: iconColor ?? scheme.onPrimaryContainer),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    value,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  Text(label,
                      style: TextStyle(
                          fontSize: 11,
                          color: scheme.onSurfaceVariant)),
                  Text(delta,
                      style: TextStyle(
                          fontSize: 10,
                          color: Colors.green.shade600)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EarningsChart extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Placeholder bar chart using containers
    final values = [0.3, 0.5, 0.4, 0.7, 0.55, 0.8, 0.65, 0.9, 0.75, 0.6, 0.85, 1.0, 0.7, 0.5];

    return Card(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '12,480 sats',
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),
                    Text(
                      'Total this month',
                      style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.green.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '+18%',
                    style: TextStyle(
                        color: Colors.green.shade700,
                        fontWeight: FontWeight.bold,
                        fontSize: 13),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 80,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: values
                    .map(
                      (v) => Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 2),
                          child: Container(
                            height: 80 * v,
                            decoration: BoxDecoration(
                              color: scheme.primary.withValues(alpha: 0.7),
                              borderRadius: const BorderRadius.vertical(
                                  top: Radius.circular(4)),
                            ),
                          ),
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  final NostrEvent event;
  const _ActivityTile({required this.event});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final timestamp =
        DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        radius: 16,
        backgroundColor: scheme.primaryContainer,
        child: Icon(Icons.article, size: 16, color: scheme.onPrimaryContainer),
      ),
      title: Text(
        event.content,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 13),
      ),
      subtitle: Text(timeago.format(timestamp),
          style: const TextStyle(fontSize: 11)),
      trailing: Icon(Icons.chevron_right,
          size: 18, color: scheme.onSurfaceVariant),
      onTap: () {},
    );
  }
}

class _ActivitySkeleton extends StatelessWidget {
  const _ActivitySkeleton();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        4,
        (_) => const ListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          leading: CircleAvatar(radius: 16),
          title: SizedBox(height: 12),
        ),
      ),
    );
  }
}

class _ActivityEmpty extends StatelessWidget {
  const _ActivityEmpty();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Center(
        child: Text(
          'No recent activity yet.',
          style:
              TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}

class _ActivityError extends StatelessWidget {
  const _ActivityError();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Center(
        child: Text(
          'Failed to load activity.',
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      ),
    );
  }
}
