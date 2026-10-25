import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/features/sats_drops/application/sats_drops_providers.dart';
import 'package:share_plus/share_plus.dart';
import 'package:timeago/timeago.dart' as timeago;

class SatsDropsScreen extends ConsumerStatefulWidget {
  const SatsDropsScreen({super.key});

  @override
  ConsumerState<SatsDropsScreen> createState() => _SatsDropsScreenState();
}

class _SatsDropsScreenState extends ConsumerState<SatsDropsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final active = ref.watch(activeDropsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sats Drops'),
        bottom: TabBar(
          controller: _tabController,
          tabs: [
            Tab(text: 'Active (${active.length})'),
            const Tab(text: 'Completed'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: const [
          _DropsTab(active: true),
          _DropsTab(active: false),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateDropSheet(context),
        icon: const AppIcon('gift'),
        label: const Text('New Drop'),
      ),
    );
  }

  void _showCreateDropSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => const _CreateDropSheet(),
    );
  }
}

class _DropsTab extends ConsumerWidget {
  final bool active;
  const _DropsTab({required this.active});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final drops = ref.watch(
      active ? activeDropsProvider : claimedDropsProvider,
    );

    if (drops.isEmpty) {
      return EmptyState(
        icon: Icons.water_drop_outlined,
        title: active ? 'No active drops' : 'Nothing completed yet',
        subtitle: active
            ? 'Create a drop to share sats with your community.'
            : 'Drops you finish sharing land here.',
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: drops.length,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (context, i) => _DropCard(drop: drops[i], active: active),
    );
  }
}

class _DropCard extends ConsumerWidget {
  final SatsDrop drop;
  final bool active;
  const _DropCard({required this.drop, required this.active});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final progress = drop.totalClaims == 0
        ? 0.0
        : drop.claimed / drop.totalClaims;

    final zapColor = AppActionColors.zapFor(scheme.brightness);

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        drop.label,
                        style: Theme.of(context)
                            .textTheme
                            .titleSmall
                            ?.copyWith(fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          AppIcon('zap', size: 14, color: zapColor),
                          Text(
                            '${drop.amountSats} sats per claim',
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(
                                  color: zapColor,
                                  fontWeight: FontWeight.w600,
                                  fontFeatures: const [
                                    FontFeature.tabularFigures()
                                  ],
                                ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const AppIcon('share'),
                  onPressed: () => _share(context),
                  tooltip: 'Share drop',
                ),
                IconButton(
                  icon: AppIcon('eye_off', color: scheme.error),
                  onPressed: () => _delete(context, ref),
                  tooltip: 'Delete drop',
                ),
              ],
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: progress,
              backgroundColor: scheme.surfaceContainerHighest,
              color: zapColor,
              borderRadius: AppShapes.radiusXs,
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text(
                  '${drop.claimed}/${drop.totalClaims} claimed',
                  style: Theme.of(context)
                      .textTheme
                      .labelSmall
                      ?.copyWith(
                        color: scheme.onSurfaceVariant,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                ),
                const Spacer(),
                Text(
                  timeago.format(drop.createdAt),
                  style: Theme.of(context)
                      .textTheme
                      .labelSmall
                      ?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ],
            ),
            if (active) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: FilledButton.tonalIcon(
                  onPressed: () => _markClaimed(context, ref),
                  icon: const AppIcon('check', size: 18),
                  label: const Text('Mark one claim paid'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _share(BuildContext context) async {
    final text = '💧 Sats Drop: ${drop.label}\n'
        '⚡ ${drop.amountSats} sats per person · '
        '${drop.totalClaims - drop.claimed} of ${drop.totalClaims} left\n'
        'Reply or zap me to claim yours!';
    await SharePlus.instance.share(ShareParams(text: text));
  }

  Future<void> _markClaimed(BuildContext context, WidgetRef ref) async {
    final confirmed = await AppDialog.confirm(
      context,
      title: 'Mark one claim as paid?',
      message:
          'Confirm you sent ${drop.amountSats} sats to one claimer of "${drop.label}".',
      confirmLabel: 'Paid',
    );
    if (confirmed == true) {
      await ref.read(satsDropsProvider.notifier).markClaimed(drop.id);
      if (context.mounted) {
        AppToast.success(context, 'Claim recorded');
      }
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final confirmed = await AppDialog.confirm(
      context,
      title: 'Delete this drop?',
      message: '"${drop.label}" and its claim counter are removed.',
      confirmLabel: 'Delete',
      isDestructive: true,
    );
    if (confirmed == true) {
      await ref.read(satsDropsProvider.notifier).delete(drop.id);
      if (context.mounted) {
        AppToast.success(context, 'Drop deleted');
      }
    }
  }
}

class _CreateDropSheet extends ConsumerStatefulWidget {
  const _CreateDropSheet();

  @override
  ConsumerState<_CreateDropSheet> createState() => _CreateDropSheetState();
}

class _CreateDropSheetState extends ConsumerState<_CreateDropSheet> {
  final _labelCtrl = TextEditingController();
  final _amountCtrl = TextEditingController();
  final _countCtrl = TextEditingController();
  bool _creating = false;

  @override
  void dispose() {
    _labelCtrl.dispose();
    _amountCtrl.dispose();
    _countCtrl.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final label = _labelCtrl.text.trim();
    final amount = int.tryParse(_amountCtrl.text.trim());
    final count = int.tryParse(_countCtrl.text.trim());
    if (label.isEmpty) {
      AppToast.warning(context, 'Give the drop a label');
      return;
    }
    if (amount == null || amount <= 0) {
      AppToast.warning(context, 'Enter sats per claim');
      return;
    }
    if (count == null || count <= 0) {
      AppToast.warning(context, 'Enter the number of claims');
      return;
    }

    setState(() => _creating = true);
    try {
      final drop =
          await ref.read(satsDropsProvider.notifier).create(
                label: label,
                amountSats: amount,
                totalClaims: count,
              );
      if (mounted) {
        Navigator.pop(context);
        AppToast.success(context, 'Drop created — share it to start');
        // Offer to share right away.
        final text = '💧 Sats Drop: ${drop.label}\n'
            '⚡ ${drop.amountSats} sats per person · '
            '${drop.totalClaims} claims\n'
            'Reply or zap me to claim yours!';
        await SharePlus.instance.share(ShareParams(text: text));
      }
    } finally {
      if (mounted) setState(() => _creating = false);
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
          Text('Create Sats Drop',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          TextField(
            controller: _labelCtrl,
            decoration: const InputDecoration(
                labelText: 'Label', hintText: 'e.g. Conference Giveaway'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _amountCtrl,
            decoration: const InputDecoration(
                labelText: 'Amount per claim (sats)', hintText: 'e.g. 1000'),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _countCtrl,
            decoration: const InputDecoration(
                labelText: 'Number of claims', hintText: 'e.g. 50'),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _creating ? null : _create,
              icon: _creating
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const AppIcon('gift'),
              label: Text(_creating ? 'Creating…' : 'Create & Share'),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'The drop tracks how many people you\'ve paid — share the link, '
            'then mark each claim as you zap it.',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
