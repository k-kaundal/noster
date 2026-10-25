import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/groups/application/group_providers.dart';
import 'package:nostrfeed_mobile/features/groups/create_group_sheet.dart';
import 'package:nostrfeed_mobile/features/groups/domain/group_models.dart';
import 'package:timeago/timeago.dart' as timeago;

/// Groups home: browse NIP-29 relay groups + "My Groups" + join/leave.
class GroupsScreen extends ConsumerWidget {
  const GroupsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final groupsAsync = ref.watch(groupsProvider);
    final myGroupsAsync = ref.watch(myGroupsProvider);
    final auth = ref.watch(authStateProvider);

    return DetailScaffold(
      title: 'Groups',
      body: groupsAsync.when(
        loading: () => const SkeletonList(),
        error: (err, _) => ErrorView.fromError(
          err,
          onRetry: () => ref.invalidate(groupsProvider),
        ),
        data: (groups) {
          final myGroups = myGroupsAsync.valueOrNull ?? [];
          final myIds = myGroups.map((g) => g.groupId).toSet();
          final discover = groups
              .where((g) => !myIds.contains(g.groupId))
              .toList();

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(groupsProvider);
              ref.invalidate(myGroupsProvider);
            },
            child: ListView(
              padding: const EdgeInsets.all(12),
              children: [
                // ── My Groups ──
                if (myGroups.isNotEmpty) ...[
                  _SectionHeader(title: 'My Groups (${myGroups.length})'),
                  for (final g in myGroups)
                    _GroupCard(group: g, isMember: true),
                  const SizedBox(height: 16),
                ],

                // ── Discover ──
                _SectionHeader(title: myGroups.isEmpty ? 'Groups' : 'Discover'),
                if (groups.isEmpty)
                  const EmptyState(
                    icon: Icons.group_outlined,
                    title: 'No groups found',
                    subtitle: 'Relay-hosted groups will appear here.',
                  )
                else if (discover.isEmpty && myGroups.isNotEmpty)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(
                      child: Text('You joined all available groups 🎉'),
                    ),
                  )
                else
                  for (final g in discover)
                    _GroupCard(group: g, isMember: false),
              ],
            ),
          );
        },
      ),
      floatingActionButton: auth.isLoggedIn
          ? FloatingActionButton.extended(
              onPressed: () => showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                showDragHandle: true,
                builder: (_) => const CreateGroupSheet(),
              ),
              icon: const AppIcon('plus'),
              label: const Text('Create Group'),
            )
          : null,
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Text(
        title.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
              color: Theme.of(context).colorScheme.primary,
            ),
      ),
    );
  }
}

class _GroupCard extends ConsumerWidget {
  final GroupInfo group;
  final bool isMember;
  const _GroupCard({required this.group, required this.isMember});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final membersAsync = ref.watch(groupMembersProvider(group.groupId));
    final memberCount = membersAsync.valueOrNull?.length;
    final auth = ref.watch(authStateProvider);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/groups/chat', extra: _toEvent(group)),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              SafeAvatar(
                imageUrl: group.picture,
                radius: 26,
                backgroundColor: scheme.primaryContainer,
                fallback: AppIcon(
                  'group',
                  color: scheme.onPrimaryContainer,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            group.name,
                            style: Theme.of(context)
                                .textTheme
                                .titleSmall
                                ?.copyWith(fontWeight: FontWeight.bold),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (!group.isPublic) ...[
                          const SizedBox(width: 5),
                          AppIcon(
                            'key',
                            size: AppIconSize.xs,
                            color: scheme.onSurfaceVariant,
                          ),
                        ],
                        if (!group.isOpen) ...[
                          const SizedBox(width: 5),
                          AppIcon(
                            'key',
                            size: AppIconSize.xs,
                            color: scheme.onSurfaceVariant,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [
                        if (memberCount != null)
                          '$memberCount member${memberCount == 1 ? '' : 's'}',
                        'active ${timeago.format(DateTime.fromMillisecondsSinceEpoch(group.createdAt * 1000))}',
                      ].join(' · '),
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                    if (group.about.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        group.about,
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
              const SizedBox(width: 8),
              if (auth.isLoggedIn && !auth.isReadOnly)
                _JoinButton(group: group, isMember: isMember),
            ],
          ),
        ),
      ),
    );
  }

  // GroupInfo → minimal NostrEvent for the chat screen (which reads tags).
  NostrEvent _toEvent(GroupInfo g) => NostrEvent(
    id: g.id,
    pubkey: g.relayPubkey,
    createdAt: g.createdAt,
    kind: 39000,
    content: '',
    tags: [
      ['d', g.groupId],
      ['name', g.name],
      if (g.about.isNotEmpty) ['about', g.about],
      if (g.picture != null) ['picture', g.picture!],
    ],
    sig: '',
  );
}

class _JoinButton extends ConsumerStatefulWidget {
  final GroupInfo group;
  final bool isMember;
  const _JoinButton({required this.group, required this.isMember});

  @override
  ConsumerState<_JoinButton> createState() => _JoinButtonState();
}

class _JoinButtonState extends ConsumerState<_JoinButton> {
  bool _busy = false;

  Future<void> _toggle() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final controller = ref.read(groupControllerProvider);
      if (widget.isMember) {
        await controller.leave(widget.group.groupId);
        if (mounted) AppToast.info(context, 'Left group');
      } else {
        await controller.join(widget.group.groupId);
        if (mounted) AppToast.success(context, 'Join request sent');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return FilledButton.tonal(
      onPressed: _busy ? null : _toggle,
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 34),
        padding: const EdgeInsets.symmetric(horizontal: 14),
      ),
      child: _busy
          ? const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Text(
              widget.isMember
                  ? 'Leave'
                  : (widget.group.isOpen ? 'Join' : 'Request'),
              style: Theme.of(context).textTheme.labelLarge,
            ),
    );
  }
}
