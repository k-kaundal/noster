import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/bounties/application/bounty_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:timeago/timeago.dart' as timeago;

class BountiesScreen extends ConsumerStatefulWidget {
  const BountiesScreen({super.key});

  @override
  ConsumerState<BountiesScreen> createState() => _BountiesScreenState();
}

class _BountiesScreenState extends ConsumerState<BountiesScreen> {
  String _filter = 'All';
  static const _filters = ['All', 'Open', 'In Progress', 'Completed'];

  bool _matches(NostrEvent e) {
    if (_filter == 'All') return true;
    final status = e.getTag('status') ?? 'active';
    return switch (_filter) {
      'Open' => status == 'active',
      'In Progress' => status == 'in_progress',
      'Completed' => status == 'sold' || status == 'completed',
      _ => true,
    };
  }

  @override
  Widget build(BuildContext context) {
    final bounties = ref.watch(bountiesProvider);

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
        value: bounties.whenData(
          (events) => events.where(_matches).toList(),
        ),
        onRefresh: () async => ref.invalidate(bountiesProvider),
        emptyState: EmptyState(
          icon: Icons.emoji_events_outlined,
          title: _filter == 'All' ? 'No bounties yet' : 'No $_filter bounties',
          subtitle: 'Post a bounty and get work done by the Nostr community.',
        ),
        separator: const SizedBox(height: 10),
        padding: const EdgeInsets.all(12),
        itemBuilder: (context, event) => _BountyCard(event: event),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateBountySheet(context),
        icon: const AppIcon('plus'),
        label: const Text('New Bounty'),
      ),
    );
  }

  void _showCreateBountySheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => const _CreateBountySheet(),
    );
  }
}

class _CreateBountySheet extends ConsumerStatefulWidget {
  const _CreateBountySheet();

  @override
  ConsumerState<_CreateBountySheet> createState() =>
      _CreateBountySheetState();
}

class _CreateBountySheetState extends ConsumerState<_CreateBountySheet> {
  final _titleCtrl = TextEditingController();
  final _rewardCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  bool _publishing = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _rewardCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _publish() async {
    final title = _titleCtrl.text.trim();
    final reward = int.tryParse(_rewardCtrl.text.trim());
    if (title.isEmpty) {
      AppToast.warning(context, 'Give the bounty a title');
      return;
    }
    if (reward == null || reward <= 0) {
      AppToast.warning(context, 'Enter a reward in sats');
      return;
    }
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to publish a bounty');
      return;
    }

    setState(() => _publishing = true);
    try {
      await ref.read(bountyControllerProvider).createBounty(
            title: title,
            description: _descCtrl.text.trim(),
            rewardSats: reward,
          );
      if (mounted) {
        Navigator.pop(context);
        AppToast.success(context, 'Bounty published');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _publishing = false);
        AppToast.error(context, 'Could not publish: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
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
          Text('Create Bounty',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          TextField(
            controller: _titleCtrl,
            decoration: const InputDecoration(
                labelText: 'Title', hintText: 'What do you need done?'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _rewardCtrl,
            decoration: const InputDecoration(
                labelText: 'Reward (sats)', hintText: 'e.g. 50000'),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _descCtrl,
            decoration:
                const InputDecoration(labelText: 'Description', hintText: ''),
            maxLines: 3,
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _publishing ? null : _publish,
              icon: _publishing
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const AppIcon('check'),
              label: Text(_publishing ? 'Publishing…' : 'Publish Bounty'),
            ),
          ),
        ],
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
    // NIP-99 price tag: [price, amount, currency] — sats here.
    final price = event.getTags('price');
    final reward = price.length > 1
        ? int.tryParse(price[1]) ?? 0
        : 0;
    final status = event.getTag('status') ?? 'active';
    const submissions = 0; // Submission counting needs a NIP — not shown.
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final timestamp =
        DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    final (statusLabel, statusColor) = switch (status) {
      'active' => ('OPEN', AppStatusColors.success),
      'in_progress' => ('IN PROGRESS', AppStatusColors.info),
      'sold' || 'completed' => ('COMPLETED', scheme.onSurfaceVariant),
      _ => (status.toUpperCase(), AppStatusColors.success),
    };
    final zapColor = AppActionColors.zapFor(scheme.brightness);

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: InkWell(
        onTap: () => _showDetails(context),
        borderRadius: AppShapes.radiusLg,
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
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(fontWeight: FontWeight.bold),
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
                      borderRadius: AppShapes.radiusXs,
                    ),
                    child: Text(
                      statusLabel,
                      style: Theme.of(context)
                          .textTheme
                          .labelSmall
                          ?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: statusColor,
                          ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  AppIcon('zap', size: 16, color: zapColor),
                  const SizedBox(width: 4),
                  Text(
                    '${_formatSats(reward)} sats',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: zapColor,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                  ),
                  const Spacer(),
                  if (submissions > 0) ...[
                    AppIcon('check', size: 14, color: scheme.onSurfaceVariant),
                    const SizedBox(width: 4),
                    Text('$submissions submissions',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: scheme.onSurfaceVariant)),
                  ],
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
                      fallback: const AppIcon('users', size: 12),
                    ),
                    loading: () => const CircleAvatar(radius: 12),
                    error: (_, _) =>
                        const CircleAvatar(radius: 12, child: AppIcon('users', size: 12)),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      profileAsync.value?.displayNameOrName ??
                          '${event.pubkey.substring(0, 8)}…',
                      style: Theme.of(context).textTheme.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    timeago.format(timestamp),
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showDetails(BuildContext context) {
    final title = event.getTag('title') ?? 'Bounty';
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: Theme.of(ctx)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            SelectableText(
              event.content,
              style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(height: 1.5),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: event.content));
                      AppToast.success(ctx, 'Description copied');
                    },
                    icon: const AppIcon('edit', size: 18),
                    label: const Text('Copy'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () {
                      Navigator.pop(ctx);
                      // Contact the bounty poster via DM.
                      Navigator.of(context).pushNamed('/chat');
                    },
                    icon: const AppIcon('comment', size: 18),
                    label: const Text('Contact'),
                  ),
                ),
              ],
            ),
          ],
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
