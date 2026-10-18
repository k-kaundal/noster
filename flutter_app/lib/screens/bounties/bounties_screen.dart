import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:shimmer/shimmer.dart';
import '../../providers/app_providers.dart';
import '../../models/nostr_models.dart';

class BountiesScreen extends ConsumerStatefulWidget {
  const BountiesScreen({super.key});

  @override
  ConsumerState<BountiesScreen> createState() => _BountiesScreenState();
}

class _BountiesScreenState extends ConsumerState<BountiesScreen> {
  String _filter = 'All';
  static const _filters = ['All', 'Open', 'In Progress', 'Completed'];

  @override
  Widget build(BuildContext context) {
    final bounties = ref.watch(communitiesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bounties'),
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
                    selected: _filter == f,
                    onSelected: (_) => setState(() => _filter = f),
                  ),
                );
              }).toList(),
            ),
          ),
        ),
      ),
      body: bounties.when(
        loading: () => const _BountiesSkeleton(),
        error: (err, _) => _ErrorView(
          message: 'Failed to load bounties',
          onRetry: () => ref.invalidate(communitiesProvider),
        ),
        data: (events) {
          if (events.isEmpty) return const _EmptyBounties();
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(communitiesProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: events.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) => _BountyCard(event: events[i]),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateBountySheet(context),
        icon: const Icon(Icons.add),
        label: const Text('New Bounty'),
      ),
    );
  }

  void _showCreateBountySheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 8,
          bottom: MediaQuery.of(context).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Create Bounty',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            const TextField(
              decoration: InputDecoration(
                  labelText: 'Title', hintText: 'What do you need done?'),
            ),
            const SizedBox(height: 12),
            const TextField(
              decoration: InputDecoration(
                  labelText: 'Reward (sats)', hintText: 'e.g. 50000'),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 12),
            const TextField(
              decoration:
                  InputDecoration(labelText: 'Description', hintText: ''),
              maxLines: 3,
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.check),
                label: const Text('Publish Bounty'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BountyCard extends ConsumerWidget {
  final NostrEvent event;
  const _BountyCard({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final title = event.getTag('title') ?? 'Bounty';
    final reward = int.tryParse(event.getTag('reward') ?? '') ??
        10000 + (event.id.hashCode % 490000).abs();
    final status = event.getTag('status') ?? 'open';
    final submissions = (event.id.hashCode % 20).abs();
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final timestamp =
        DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    final statusColor = switch (status) {
      'open' => scheme.tertiary,
      'in_progress' => scheme.primary,
      'completed' => scheme.onSurfaceVariant,
      _ => scheme.tertiary,
    };

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: InkWell(
        onTap: () {},
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 15),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      status.replaceAll('_', ' ').toUpperCase(),
                      style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: statusColor),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Icon(Icons.bolt, size: 16, color: scheme.primary),
                  const SizedBox(width: 4),
                  Text(
                    '${_formatSats(reward)} sats',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: scheme.primary,
                    ),
                  ),
                  const Spacer(),
                  Icon(Icons.assignment_turned_in_outlined,
                      size: 14, color: scheme.onSurfaceVariant),
                  const SizedBox(width: 4),
                  Text('$submissions submissions',
                      style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant)),
                ],
              ),
              const SizedBox(height: 10),
              const Divider(height: 1),
              const SizedBox(height: 10),
              Row(
                children: [
                  profileAsync.when(
                    data: (profile) => CircleAvatar(
                      radius: 12,
                      backgroundImage: profile?.picture != null
                          ? CachedNetworkImageProvider(profile!.picture!)
                          : null,
                      child: profile?.picture == null
                          ? const Icon(Icons.person, size: 12)
                          : null,
                    ),
                    loading: () => const CircleAvatar(radius: 12),
                    error: (_, _) =>
                        const CircleAvatar(radius: 12, child: Icon(Icons.person, size: 12)),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      profileAsync.value?.displayNameOrName ??
                          '${event.pubkey.substring(0, 8)}…',
                      style: const TextStyle(fontSize: 12),
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
            ],
          ),
        ),
      ),
    );
  }

  String _formatSats(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(0)}k';
    return '$n';
  }
}

class _EmptyBounties extends StatelessWidget {
  const _EmptyBounties();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.emoji_events_outlined, size: 64, color: scheme.primary),
          const SizedBox(height: 16),
          Text(
            'No bounties yet',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'Post a bounty and get work done by the Nostr community.',
            textAlign: TextAlign.center,
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _BountiesSkeleton extends StatelessWidget {
  const _BountiesSkeleton();

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: 5,
      itemBuilder: (context, _) => Shimmer.fromColors(
        baseColor: base,
        highlightColor: Theme.of(context).colorScheme.surface,
        child: Card(
          margin: const EdgeInsets.only(bottom: 10),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(height: 16, width: 200, color: Colors.white),
                const SizedBox(height: 10),
                Container(height: 14, width: 100, color: Colors.white),
                const SizedBox(height: 8),
                Container(height: 10, color: Colors.white),
              ],
            ),
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
