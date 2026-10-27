import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';

import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/market/application/market_providers.dart';
import 'package:nostrfeed_mobile/features/p2p/domain/p2p_order.dart';
import 'package:timeago/timeago.dart' as timeago;

/// P2P trade book (NIP-69 kind 38383): buy/sell order book + create order.
class P2PScreen extends ConsumerStatefulWidget {
  const P2PScreen({super.key});

  @override
  ConsumerState<P2PScreen> createState() => _P2PScreenState();
}

class _P2PScreenState extends ConsumerState<P2PScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

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
    final ordersAsync = ref.watch(p2pOrdersProvider);
    final auth = ref.watch(authStateProvider);

    return DetailScaffold(
      title: 'P2P Trading',
      bottom: TabBar(
        controller: _tabController,
        labelColor: Theme.of(context).colorScheme.primary,
        unselectedLabelColor: Theme.of(context).colorScheme.onSurfaceVariant,
        indicatorColor: Theme.of(context).colorScheme.primary,
        tabs: const [
          Tab(text: 'Sell offers'),
          Tab(text: 'Buy offers'),
        ],
      ),
      body: ordersAsync.when(
        loading: () => const SkeletonList(itemCount: 4),
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Failed to load orders'),
              TextButton(
                onPressed: () => ref.invalidate(p2pOrdersProvider),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (events) {
          final orders = events.map(P2POrder.fromEvent).toList();
          final sells = orders.where((o) => o.isSell && o.isOpen).toList();
          final buys = orders.where((o) => o.isBuy && o.isOpen).toList();

          return TabBarView(
            controller: _tabController,
            children: [
              _OrderList(orders: sells, emptyLabel: 'No sell offers'),
              _OrderList(orders: buys, emptyLabel: 'No buy offers'),
            ],
          );
        },
      ),
      floatingActionButton: auth.isLoggedIn
          ? FloatingActionButton.extended(
              onPressed: () => showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                showDragHandle: true,
                builder: (_) => const _CreateOrderSheet(),
              ),
              icon: const AppIcon('repost'),
              label: const Text('New Order'),
            )
          : null,
    );
  }
}

class _OrderList extends ConsumerWidget {
  final List<P2POrder> orders;
  final String emptyLabel;

  const _OrderList({required this.orders, required this.emptyLabel});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (orders.isEmpty) {
      return EmptyState(
        icon: Icons.swap_horiz_rounded,
        title: emptyLabel,
        subtitle: 'P2P trade orders will appear here.',
      );
    }
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(p2pOrdersProvider),
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: orders.length + 1,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, i) =>
            i == 0 ? const _EscrowNote() : _OrderCard(order: orders[i - 1]),
      ),
    );
  }
}

/// Trades settle over encrypted chat with Lightning escrow (NIP-69/Mostro) —
/// a quiet note, shown once at the top of the book.
class _EscrowNote extends StatelessWidget {
  const _EscrowNote();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusMd,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Row(
        children: [
          AppIcon('key', size: AppIconSize.md, color: scheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Trades settle over encrypted chat with Lightning escrow — the sats are locked until both sides confirm.',
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: scheme.onSurfaceVariant, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

class _OrderCard extends ConsumerWidget {
  final P2POrder order;
  const _OrderCard({required this.order});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final makerAsync = ref.watch(profileProvider(order.makerPubkey));
    final maker = makerAsync.valueOrNull;
    final isBuy = order.isBuy;

    final typeColor = isBuy ? AppStatusColors.success : AppStatusColors.warning;

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Type + amount header
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: typeColor.withValues(alpha: 0.15),
                    borderRadius: AppShapes.radiusSm,
                  ),
                  child: Text(
                    isBuy ? 'BUY' : 'SELL',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: typeColor,
                          letterSpacing: 0.5,
                        ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    order.amountDisplay,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(
                          fontWeight: FontWeight.bold,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (order.premium != null)
                  Text(
                    '+${order.premium}%',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: scheme.primary,
                        ),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            // Payment methods
            if (order.paymentMethods.isNotEmpty)
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  for (final pm in order.paymentMethods)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: scheme.surfaceContainerHighest,
                        borderRadius: AppShapes.radiusXs,
                      ),
                      child: Text(
                        pm,
                        style: Theme.of(context)
                            .textTheme
                            .labelSmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ),
                ],
              ),
            const SizedBox(height: 10),
            // Maker + time + action
            Row(
              children: [
                SafeAvatar(
                  imageUrl: maker?.picture,
                  radius: 12,
                  fallback: const AppIcon('users', size: 12),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    [
                      order.makerName?.isNotEmpty == true
                          ? order.makerName!
                          : maker?.displayNameOrName ??
                              '${order.makerPubkey.substring(0, 8)}…',
                      timeago.format(
                        DateTime.fromMillisecondsSinceEpoch(
                            order.createdAt * 1000),
                        locale: 'en_short',
                      ),
                    ].join(' · '),
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                FilledButton.tonal(
                  onPressed: () => _takeOrder(context, ref),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 32),
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                  ),
                  child: Text(
                    isBuy ? 'Sell to them' : 'Buy from them',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Taking an order = DM the maker to start the trade (P2P trades happen
  /// over encrypted chat + Lightning escrow, per NIP-69/Mostro).
  void _takeOrder(BuildContext context, WidgetRef ref) {
    context.push('/chat/${order.makerPubkey}');
  }
}

/// Create-order sheet (NIP-69).
class _CreateOrderSheet extends ConsumerStatefulWidget {
  const _CreateOrderSheet();

  @override
  ConsumerState<_CreateOrderSheet> createState() => _CreateOrderSheetState();
}

class _CreateOrderSheetState extends ConsumerState<_CreateOrderSheet> {
  final _fiatCtrl = TextEditingController();
  final _currencyCtrl = TextEditingController(text: 'USD');
  final _pmCtrl = TextEditingController();
  final _premiumCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  String _type = 'sell';
  bool _publishing = false;

  @override
  void dispose() {
    _fiatCtrl.dispose();
    _currencyCtrl.dispose();
    _pmCtrl.dispose();
    _premiumCtrl.dispose();
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _publish() async {
    setState(() => _publishing = true);
    try {
      final pm = _pmCtrl.text
          .split(',')
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty)
          .toList();
      await ref.read(marketControllerProvider).createOrder(
            type: _type,
            currency: _currencyCtrl.text.trim().toUpperCase(),
            fiatAmount: _fiatCtrl.text.trim().isEmpty
                ? null
                : _fiatCtrl.text.trim(),
            paymentMethods: pm,
            premium: _premiumCtrl.text.trim().isEmpty
                ? null
                : _premiumCtrl.text.trim(),
            makerName: _nameCtrl.text.trim().isEmpty
                ? null
                : _nameCtrl.text.trim(),
          );
      if (!mounted) return;
      Navigator.pop(context);
      AppToast.success(context, 'Order published');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Publish failed: $e');
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'New P2P Order',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  icon: const AppIcon('plus'),
                  tooltip: 'Close',
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
            const SizedBox(height: 16),
            // Buy / Sell toggle
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                  value: 'sell',
                  label: Text('I want to SELL sats'),
                  icon: AppIcon('arrow_down'),
                ),
                ButtonSegment(
                  value: 'buy',
                  label: Text('I want to BUY sats'),
                  icon: AppIcon('arrow_up'),
                ),
              ],
              selected: {_type},
              onSelectionChanged: (s) => setState(() => _type = s.first),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: _fiatCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Fiat amount',
                      hintText: 'e.g. 100 or 50-200',
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _currencyCtrl,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(labelText: 'Currency'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _pmCtrl,
              decoration: const InputDecoration(
                labelText: 'Payment methods, comma separated',
                hintText: 'e.g. bank transfer, face to face, revolut',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _premiumCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Premium % (optional)',
                hintText: 'e.g. 1 for +1% over market',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _nameCtrl,
              decoration: const InputDecoration(
                labelText: 'Display name (optional)',
                hintText: 'How traders see you',
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _publishing ? null : _publish,
                icon: _publishing
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: colorScheme.onPrimary,
                        ),
                      )
                    : const AppIcon('share'),
                label: const Text('Publish order'),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Published as a NIP-69 P2P order (kind 38383) — traders contact you via encrypted chat to trade with Lightning escrow.',
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
