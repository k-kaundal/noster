import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';

class ListsScreen extends ConsumerWidget {
  const ListsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Reuse bookmarks provider as placeholder; lists are kind 30000+ sets
    final lists = ref.watch(bookmarksProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Lists'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () {},
            tooltip: 'Search lists',
          ),
        ],
      ),
      body: lists.when(
        loading: () => const SkeletonList(),
        error: (err, _) => ErrorView(
          message: 'Failed to load lists',
          onRetry: () => ref.invalidate(bookmarksProvider),
        ),
        data: (events) {
          if (events.isEmpty) {
            return const EmptyState(
              icon: Icons.list_alt,
              title: 'No lists yet',
              subtitle:
                  'Create follow sets and curated lists of Nostr users.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: events.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, i) => _ListCard(event: events[i]),
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateListSheet(context),
        icon: const Icon(Icons.playlist_add),
        label: const Text('New List'),
      ),
    );
  }

  void _showCreateListSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) {
        final nameCtrl = TextEditingController();
        final descCtrl = TextEditingController();
        return Padding(
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
              Text('Create List',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              TextField(
                controller: nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'List name',
                  hintText: 'e.g. Bitcoin Devs',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: descCtrl,
                decoration: const InputDecoration(
                  labelText: 'Description (optional)',
                ),
                maxLines: 2,
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.check),
                  label: const Text('Create'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ListCard extends StatelessWidget {
  final NostrEvent event;
  const _ListCard({required this.event});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final name = event.getTag('d') ?? event.getTag('title') ?? 'Untitled List';
    final members = event.getTags('p');

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: ListTile(
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: scheme.primaryContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(Icons.list, color: scheme.onPrimaryContainer),
        ),
        title: Text(
          name,
          style: const TextStyle(fontWeight: FontWeight.w600),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text('${members.length} members',
                style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
            const SizedBox(height: 6),
            if (members.isNotEmpty)
              SizedBox(
                height: 24,
                child: Stack(
                  children: List.generate(
                    members.length > 5 ? 5 : members.length,
                    (i) => Positioned(
                      left: i * 18.0,
                      child: CircleAvatar(
                        radius: 12,
                        backgroundColor: scheme.secondaryContainer,
                        child: Icon(Icons.person,
                            size: 12, color: scheme.onSecondaryContainer),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: () {},
      ),
    );
  }
}


