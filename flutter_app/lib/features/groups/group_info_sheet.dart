import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/groups/providers/group_providers.dart';

/// Group info bottom sheet: about, members (with admin remove), admins,
/// and leave group. Opened from the group chat header.
class GroupInfoSheet extends ConsumerWidget {
  final NostrEvent groupEvent;
  const GroupInfoSheet({super.key, required this.groupEvent});

  String get _groupId => groupEvent.getTag('d') ?? groupEvent.id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final name = groupEvent.getTag('name') ?? 'Group';
    final about = groupEvent.getTag('about') ?? '';
    final membersAsync = ref.watch(groupMembersProvider(_groupId));
    final adminsAsync = ref.watch(groupAdminsProvider(_groupId));
    final isAdmin = ref.watch(isGroupAdminProvider(_groupId)).value ?? false;
    final auth = ref.watch(authStateProvider);

    final members = membersAsync.valueOrNull ?? [];
    final admins = adminsAsync.valueOrNull ?? {};

    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) => ListView(
        controller: scrollController,
        padding: const EdgeInsets.all(20),
        children: [
          // Header
          Row(
            children: [
              Expanded(
                child: Text(
                  name,
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close_rounded),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
          if (about.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              about,
              style: TextStyle(
                fontSize: 13,
                color: scheme.onSurfaceVariant,
                height: 1.35,
              ),
            ),
          ],
          const SizedBox(height: 16),

          // Admins
          if (admins.isNotEmpty) ...[
            _SectionLabel('Admins (${admins.length})'),
            for (final entry in admins.entries)
              _MemberTile(
                pubkey: entry.key,
                roles: entry.value,
                isAdmin: true,
              ),
            const SizedBox(height: 12),
          ],

          // Members
          _SectionLabel('Members (${members.length})'),
          if (membersAsync.isLoading)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (members.isEmpty)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('No members found'),
            )
          else
            for (final pk in members)
              _MemberTile(
                pubkey: pk,
                roles: admins[pk] ?? [],
                isAdmin: admins.containsKey(pk),
                canRemove: isAdmin && pk != auth.pubkey,
                onRemove: () => _removeMember(context, ref, pk),
              ),

          const SizedBox(height: 20),
          // Leave group
          if (auth.isLoggedIn && !auth.isReadOnly)
            OutlinedButton.icon(
              onPressed: () => _leaveGroup(context, ref),
              icon: Icon(Icons.logout_rounded, color: scheme.error),
              label: Text('Leave group',
                  style: TextStyle(color: scheme.error)),
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: scheme.error.withValues(alpha: 0.5)),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _removeMember(
      BuildContext context, WidgetRef ref, String pubkey) async {
    final confirmed = await AppDialog.confirm(
      context,
      title: 'Remove member?',
      message: 'Remove this member from the group? (NIP-29 kind 9001)',
      confirmLabel: 'Remove',
      isDestructive: true,
    );
    if (!confirmed || !context.mounted) return;
    try {
      await ref.read(groupControllerProvider).removeMember(_groupId, pubkey);
      if (context.mounted) AppToast.info(context, 'Member removed');
    } catch (e) {
      if (context.mounted) AppToast.error(context, 'Remove failed: $e');
    }
  }

  Future<void> _leaveGroup(BuildContext context, WidgetRef ref) async {
    try {
      await ref.read(groupControllerProvider).leave(_groupId);
      if (context.mounted) {
        Navigator.pop(context); // close sheet
        Navigator.pop(context); // back to groups list
        AppToast.info(context, 'Left group');
      }
    } catch (e) {
      if (context.mounted) AppToast.error(context, 'Leave failed: $e');
    }
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.4,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}

class _MemberTile extends ConsumerWidget {
  final String pubkey;
  final List<String> roles;
  final bool isAdmin;
  final bool canRemove;
  final VoidCallback? onRemove;

  const _MemberTile({
    required this.pubkey,
    this.roles = const [],
    this.isAdmin = false,
    this.canRemove = false,
    this.onRemove,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(profileProvider(pubkey));
    final profile = profileAsync.valueOrNull;
    final name = profile?.displayNameOrName ??
        '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}';

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: SafeAvatar(
        imageUrl: profile?.picture,
        radius: 20,
        fallback: Text(name.isNotEmpty ? name[0].toUpperCase() : '?'),
      ),
      title: Row(
        children: [
          Flexible(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
            ),
          ),
          if (isAdmin) ...[
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Theme.of(context)
                    .colorScheme
                    .primaryContainer
                    .withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                roles.isNotEmpty ? roles.first : 'admin',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: Theme.of(context).colorScheme.primary,
                ),
              ),
            ),
          ],
        ],
      ),
      subtitle: profile?.nip05 != null
          ? Text(
              profile!.nip05!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            )
          : null,
      trailing: canRemove
          ? IconButton(
              icon: Icon(
                Icons.person_remove_outlined,
                size: 20,
                color: Theme.of(context).colorScheme.error,
              ),
              tooltip: 'Remove member',
              onPressed: onRemove,
            )
          : null,
    );
  }
}
