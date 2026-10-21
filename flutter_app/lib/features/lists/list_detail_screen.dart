import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/feed/widgets/post_card.dart';
import 'package:nostrfeed_mobile/features/lists/models/nostr_list.dart';
import 'package:nostrfeed_mobile/features/lists/providers/list_providers.dart';

/// List detail: members management + "view as feed".
class ListDetailScreen extends ConsumerStatefulWidget {
  final NostrList list;
  const ListDetailScreen({super.key, required this.list});

  @override
  ConsumerState<ListDetailScreen> createState() => _ListDetailScreenState();
}

class _ListDetailScreenState extends ConsumerState<ListDetailScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  late NostrList _list;

  @override
  void initState() {
    super.initState();
    _list = widget.list;
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  /// Refresh the local copy from the latest provider state after mutations.
  void _syncFromProvider() {
    final fresh = ref.read(followSetsProvider).valueOrNull;
    if (fresh == null) return;
    final updated = fresh.where((l) => l.dTag == _list.dTag).firstOrNull;
    if (updated != null && mounted) setState(() => _list = updated);
  }

  Future<void> _addMember() async {
    final controller = TextEditingController();
    final added = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add member'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'npub or hex pubkey',
            hintText: 'npub1…',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    if (added == null || added.isEmpty || !mounted) return;

    // Resolve npub → hex
    final nostr = ref.read(nostrServiceProvider);
    var pk = added;
    if (added.startsWith('npub1')) {
      try {
        pk = nostr.authService.decodeNpub(added);
      } catch (_) {
        AppToast.error(context, 'Invalid npub');
        return;
      }
    }
    if (pk.length != 64) {
      AppToast.error(context, 'Enter a valid npub or 64-char hex pubkey');
      return;
    }

    try {
      await ref.read(listControllerProvider).addMember(_list, pk);
      _syncFromProvider();
      if (mounted) AppToast.success(context, 'Member added');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Add failed: $e');
    }
  }

  Future<void> _removeMember(String pubkey) async {
    try {
      await ref.read(listControllerProvider).removeMember(_list, pubkey);
      _syncFromProvider();
      if (mounted) AppToast.info(context, 'Member removed');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Remove failed: $e');
    }
  }

  Future<void> _deleteList() async {
    final confirmed = await AppDialog.confirm(
      context,
      title: 'Delete list?',
      message:
          '"${_list.title}" will be deleted. This publishes a NIP-09 deletion request to relays.',
      confirmLabel: 'Delete',
      isDestructive: true,
    );
    if (!confirmed || !mounted) return;
    try {
      await ref.read(listControllerProvider).deleteList(_list);
      if (mounted) {
        AppToast.info(context, 'List deleted');
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Delete failed: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final feedAsync = ref.watch(listFeedProvider(_list));

    return Scaffold(
      appBar: AppBar(
        title: Text(_list.title),
        actions: [
          IconButton(
            icon: const Icon(Icons.person_add_alt_rounded),
            tooltip: 'Add member',
            onPressed: _addMember,
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline_rounded),
            tooltip: 'Delete list',
            onPressed: _deleteList,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: [
            Tab(text: 'Feed (${feedAsync.valueOrNull?.length ?? 0})'),
            Tab(text: 'Members (${_list.members.length})'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // ── Feed tab: posts by list members ──
          AsyncFeedList(
            value: feedAsync,
            onRefresh: () => ref.refresh(listFeedProvider(_list).future),
            emptyState: EmptyState(
              icon: Icons.dynamic_feed_rounded,
              title: 'No posts yet',
              subtitle: _list.members.isEmpty
                  ? 'Add members to see their posts here.'
                  : 'Posts from list members will appear here.',
              action: _list.members.isEmpty
                  ? FilledButton.icon(
                      onPressed: _addMember,
                      icon: const Icon(Icons.person_add_alt_rounded),
                      label: const Text('Add members'),
                    )
                  : null,
            ),
            itemBuilder: (context, event) => PostCard(event: event),
          ),

          // ── Members tab: manage ──
          _list.members.isEmpty
              ? EmptyState(
                  icon: Icons.group_outlined,
                  title: 'No members',
                  subtitle: 'Add people to build this list.',
                  action: FilledButton.icon(
                    onPressed: _addMember,
                    icon: const Icon(Icons.person_add_alt_rounded),
                    label: const Text('Add members'),
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: _list.members.length,
                  separatorBuilder: (_, _) => const Divider(indent: 72),
                  itemBuilder: (context, i) => _MemberTile(
                    pubkey: _list.members[i],
                    onRemove: () => _removeMember(_list.members[i]),
                  ),
                ),
        ],
      ),
    );
  }
}

class _MemberTile extends ConsumerWidget {
  final String pubkey;
  final VoidCallback onRemove;

  const _MemberTile({required this.pubkey, required this.onRemove});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(profileProvider(pubkey));
    final profile = profileAsync.valueOrNull;
    final name = profile?.displayNameOrName ??
        '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}';

    return ListTile(
      leading: SafeAvatar(
        imageUrl: profile?.picture,
        radius: 22,
        fallback: Text(
          name.isNotEmpty ? name[0].toUpperCase() : '?',
        ),
      ),
      title: Text(
        name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: profile?.nip05 != null
          ? Text(
              profile!.nip05!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                color: Theme.of(context).colorScheme.primary,
              ),
            )
          : null,
      trailing: IconButton(
        icon: Icon(
          Icons.person_remove_outlined,
          color: Theme.of(context).colorScheme.error,
        ),
        tooltip: 'Remove from list',
        onPressed: onRemove,
      ),
      onTap: () => Navigator.of(context).pushNamed('/profile/$pubkey'),
    );
  }
}
