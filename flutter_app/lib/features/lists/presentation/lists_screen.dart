import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/lists/application/list_providers.dart';
import 'package:nostrfeed_mobile/features/lists/domain/nostr_list.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// Lists home: the user's NIP-51 follow sets with create + manage.
class ListsScreen extends ConsumerWidget {
  const ListsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final listsAsync = ref.watch(followSetsProvider);
    final auth = ref.watch(authStateProvider);

    return DetailScaffold(
      title: 'Lists',
      body: AsyncFeedList<NostrList>(
        value: listsAsync,
        onRefresh: () => ref.refresh(followSetsProvider.future),
        emptyState: EmptyState(
          icon: Icons.list_alt_rounded,
          title: 'No lists yet',
          subtitle:
              'Create curated lists of Nostr users — follow sets you can browse as feeds.',
          action: auth.isLoggedIn
              ? FilledButton.icon(
                  onPressed: () => _showCreateSheet(context, ref),
                  icon: const AppIcon('plus'),
                  label: const Text('Create your first list'),
                )
              : null,
        ),
        padding: const EdgeInsets.all(12),
        separator: const SizedBox(height: 8),
        itemBuilder: (context, list) => _ListCard(list: list),
      ),
      floatingActionButton: auth.isLoggedIn
          ? FloatingActionButton.extended(
              onPressed: () => _showCreateSheet(context, ref),
              icon: const AppIcon('plus'),
              label: const Text('New List'),
            )
          : null,
    );
  }

  void _showCreateSheet(BuildContext context, WidgetRef ref) {
    final nameCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 8,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Create List',
              style: Theme.of(ctx)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: nameCtrl,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
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
                onPressed: () async {
                  final title = nameCtrl.text.trim();
                  if (title.isEmpty) {
                    AppToast.warning(ctx, 'Enter a list name');
                    return;
                  }
                  Navigator.pop(ctx);
                  try {
                    await ref.read(listControllerProvider).createList(
                          title: title,
                          description: descCtrl.text.trim(),
                        );
                    if (context.mounted) {
                      AppToast.success(context, 'List "$title" created');
                    }
                  } catch (e) {
                    if (context.mounted) {
                      AppToast.error(context, 'Create failed: $e');
                    }
                  }
                },
                icon: const AppIcon('check'),
                label: const Text('Create'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ListCard extends ConsumerWidget {
  final NostrList list;
  const _ListCard({required this.list});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final memberPreview = list.members.take(4).toList();

    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: AppShapes.radiusLg,
        side: BorderSide(color: scheme.outlineVariant),
      ),
      child: InkWell(
        onTap: () => context.push('/lists/detail', extra: list),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              // Member avatar stack / list icon
              SizedBox(
                width: 56,
                height: 56,
                child: memberPreview.isEmpty
                    ? Container(
                        decoration: BoxDecoration(
                          color: scheme.primaryContainer,
                          borderRadius: AppShapes.radiusMd,
                        ),
                        child: AppIcon(
                          'users',
                          color: scheme.onPrimaryContainer,
                        ),
                      )
                    : _MemberStack(pubkeys: memberPreview),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      list.title,
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(fontWeight: FontWeight.bold),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${list.members.length} member${list.members.length == 1 ? '' : 's'}',
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                    if (list.description.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        list.description,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ],
                ),
              ),
              AppIcon(
                'chevron_r',
                color: scheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MemberStack extends ConsumerWidget {
  final List<String> pubkeys;
  const _MemberStack({required this.pubkeys});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Stack(
      children: [
        for (var i = 0; i < pubkeys.length && i < 3; i++)
          Positioned(
            left: i * 14.0,
            child: _MemberAvatar(pubkey: pubkeys[i], index: i),
          ),
      ],
    );
  }
}

class _MemberAvatar extends ConsumerWidget {
  final String pubkey;
  final int index;
  const _MemberAvatar({required this.pubkey, required this.index});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider(pubkey)).valueOrNull;
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: Theme.of(context).colorScheme.surface,
          width: 2,
        ),
      ),
      child: SafeAvatar(
        imageUrl: profile?.picture,
        radius: 16,
        fallback: Text(
          (profile?.displayNameOrName ?? pubkey).isNotEmpty
              ? firstGrapheme(profile?.displayNameOrName ?? pubkey)
              : '?',
          style: Theme.of(context).textTheme.labelSmall,
        ),
      ),
    );
  }
}
