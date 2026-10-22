import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:timeago/timeago.dart' as timeago;

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
      body: AsyncFeedList<NostrEvent>(
        value: bounties,
        onRefresh: () async => ref.invalidate(communitiesProvider),
        emptyState: const EmptyState(
          icon: Icons.emoji_events_outlined,
          title: 'No bounties yet',
          subtitle: 'Post a bounty and get work done by the Nostr community.',
        ),
        separator: const SizedBox(height: 10),
        padding: const EdgeInsets.all(12),
        itemBuilder: (context, event) => _BountyCard(event: event),
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
                    data: (profile) => SafeAvatar(
                      imageUrl: profile?.picture,
                      radius: 12,
                      fallback: const Icon(Icons.person, size: 12),
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


