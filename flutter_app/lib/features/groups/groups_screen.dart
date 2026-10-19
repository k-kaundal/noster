import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';

class GroupsScreen extends ConsumerWidget {
  const GroupsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Reuse communities provider; NIP-29 groups are kind 39000 metadata events
    final groups = ref.watch(communitiesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Groups'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () {},
            tooltip: 'Search groups',
          ),
        ],
      ),
      body: AsyncFeedList<NostrEvent>(
        value: groups,
        onRefresh: () async => ref.invalidate(communitiesProvider),
        emptyState: const EmptyState(
          icon: Icons.group_outlined,
          title: 'No groups found',
          subtitle: 'Relay-hosted groups will appear here.',
        ),
        separator: const SizedBox(height: 8),
        padding: const EdgeInsets.all(12),
        itemBuilder: (context, event) => _GroupCard(event: event),
      ),
    );
  }
}

class _GroupCard extends ConsumerStatefulWidget {
  final NostrEvent event;
  const _GroupCard({required this.event});

  @override
  ConsumerState<_GroupCard> createState() => _GroupCardState();
}

class _GroupCardState extends ConsumerState<_GroupCard> {
  bool _joined = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final event = widget.event;
    final name = event.getTag('name') ?? 'Unnamed Group';
    final about = event.getTag('about') ?? '';
    final picture = event.getTag('picture');
    final memberCount = 5 + (event.id.hashCode % 300).abs();
    final lastActivity = DateTime.fromMillisecondsSinceEpoch(
        event.createdAt * 1000);

    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: InkWell(
        onTap: () => _openGroupChat(context),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundImage: picture != null
                        ? CachedNetworkImageProvider(picture)
                        : null,
                    backgroundColor: scheme.primaryContainer,
                    child: picture == null
                        ? Icon(Icons.group,
                            color: scheme.onPrimaryContainer)
                        : null,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          style: const TextStyle(
                              fontWeight: FontWeight.bold, fontSize: 15),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '$memberCount members · active ${timeago.format(lastActivity)}',
                          style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                  FilledButton.tonal(
                    onPressed: () => setState(() => _joined = !_joined),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 32),
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                    ),
                    child: Text(
                      _joined ? 'Leave' : 'Join',
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
                ],
              ),
              if (about.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  about,
                  style: TextStyle(
                      fontSize: 13,
                      color: scheme.onSurfaceVariant,
                      height: 1.4),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              const SizedBox(height: 10),
              // Chat preview
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    Icon(Icons.chat_bubble_outline,
                        size: 14, color: scheme.onSurfaceVariant),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Tap to open group chat',
                        style: TextStyle(
                            fontSize: 12,
                            color: scheme.onSurfaceVariant,
                            fontStyle: FontStyle.italic),
                      ),
                    ),
                    Icon(Icons.chevron_right,
                        size: 16, color: scheme.onSurfaceVariant),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _openGroupChat(BuildContext context) {
    final name = widget.event.getTag('name') ?? 'Group';
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => Scaffold(
          appBar: AppBar(title: Text(name)),
          body: const Center(child: Text('Group chat coming soon')),
        ),
      ),
    );
  }
}


