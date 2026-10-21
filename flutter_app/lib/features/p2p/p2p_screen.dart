import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';

class P2PScreen extends ConsumerStatefulWidget {
  const P2PScreen({super.key});

  @override
  ConsumerState<P2PScreen> createState() => _P2PScreenState();
}

class _P2PScreenState extends ConsumerState<P2PScreen> {
  String _filter = 'All';
  static const _filters = ['All', 'Buy', 'Sell'];

  void _showNewOrderSheet(BuildContext context, WidgetRef ref) {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Log in to create an order')),
      );
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('P2P order creation needs escrow support — coming soon'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Placeholder: reuse communities provider for order events
    final orders = ref.watch(communitiesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('P2P Trading'),
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
      body: orders.when(
        loading: () => const SkeletonList(),
        error: (err, _) => ErrorView(
          message: 'Failed to load orders',
          onRetry: () => ref.invalidate(communitiesProvider),
        ),
        data: (events) {
          if (events.isEmpty) {
            return const EmptyState(
              icon: Icons.swap_horiz,
              title: 'No orders found',
              subtitle: 'P2P trade orders will appear here.',
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(communitiesProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: events.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) =>
                  _OrderCard(event: events[i], isBuy: i.isEven),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showNewOrderSheet(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('New Order'),
      ),
    );
  }
}

class _OrderCard extends ConsumerWidget {
  final NostrEvent event;
  final bool isBuy;
  const _OrderCard({required this.event, required this.isBuy});

  void _openTradeChat(BuildContext context, WidgetRef ref) {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Log in to trade')),
      );
      return;
    }
    final nostr = ref.read(nostrServiceProvider);
    final npub = nostr.authService.encodeNpub(event.pubkey);
    context.push('/chat/$npub');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final amountSats = 10000 + (event.id.hashCode % 900000).abs();
    final priceUsd = 60000 + (event.id.hashCode % 20000).abs();
    final paymentMethods = ['Lightning', 'On-chain', 'Cash', 'Bank Transfer'];
    final payment =
        paymentMethods[(event.id.hashCode % paymentMethods.length).abs()];
    final timestamp =
        DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                // Buy/Sell badge
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: isBuy
                        ? scheme.tertiaryContainer
                        : scheme.errorContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    isBuy ? 'BUY' : 'SELL',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: isBuy
                          ? scheme.onTertiaryContainer
                          : scheme.onErrorContainer,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '${_formatSats(amountSats)} sats',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                ),
                Text(
                  timeago.format(timestamp),
                  style: TextStyle(
                      fontSize: 11, color: scheme.onSurfaceVariant),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _OrderDetail(
                  icon: Icons.attach_money,
                  label: 'Rate',
                  value: '\$${_formatSats(priceUsd)}/BTC',
                ),
                const SizedBox(width: 20),
                _OrderDetail(
                  icon: Icons.payment,
                  label: 'Payment',
                  value: payment,
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Divider(height: 1),
            const SizedBox(height: 10),
            Row(
              children: [
                profileAsync.when(
                  data: (profile) => SafeAvatar(
                    imageUrl: profile?.picture,
                    radius: 14,
                    fallback: const Icon(Icons.person, size: 14),
                  ),
                  loading: () => const CircleAvatar(radius: 14),
                  error: (_, _) =>
                      const CircleAvatar(radius: 14, child: Icon(Icons.person, size: 14)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    profileAsync.value?.displayNameOrName ??
                        '${event.pubkey.substring(0, 8)}…',
                    style: const TextStyle(fontSize: 13),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                FilledButton.tonal(
                  onPressed: () => _openTradeChat(context, ref),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 44),
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                  child: const Text('Trade', style: TextStyle(fontSize: 13)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _formatSats(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(2)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(0)}k';
    return '$n';
  }
}

class _OrderDetail extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _OrderDetail(
      {required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      children: [
        Icon(icon, size: 14, color: scheme.onSurfaceVariant),
        const SizedBox(width: 4),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: TextStyle(
                    fontSize: 10, color: scheme.onSurfaceVariant)),
            Text(value,
                style: const TextStyle(
                    fontSize: 12, fontWeight: FontWeight.w600)),
          ],
        ),
      ],
    );
  }
}


