import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:shimmer/shimmer.dart';
import '../../providers/app_providers.dart';
import '../../models/nostr_models.dart';

class P2PScreen extends ConsumerStatefulWidget {
  const P2PScreen({super.key});

  @override
  ConsumerState<P2PScreen> createState() => _P2PScreenState();
}

class _P2PScreenState extends ConsumerState<P2PScreen> {
  String _filter = 'All';
  static const _filters = ['All', 'Buy', 'Sell'];

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
        loading: () => const _P2PSkeleton(),
        error: (err, _) => _ErrorView(
          message: 'Failed to load orders',
          onRetry: () => ref.invalidate(communitiesProvider),
        ),
        data: (events) {
          if (events.isEmpty) return const _EmptyP2P();
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
        onPressed: () {},
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
                        ? Colors.green.withValues(alpha: 0.15)
                        : Colors.red.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    isBuy ? 'BUY' : 'SELL',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: isBuy ? Colors.green : Colors.red,
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
                  data: (profile) => CircleAvatar(
                    radius: 14,
                    backgroundImage: profile?.picture != null
                        ? CachedNetworkImageProvider(profile!.picture!)
                        : null,
                    child: profile?.picture == null
                        ? const Icon(Icons.person, size: 14)
                        : null,
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
                  onPressed: () {},
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 30),
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                  ),
                  child: const Text('Trade', style: TextStyle(fontSize: 12)),
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

class _EmptyP2P extends StatelessWidget {
  const _EmptyP2P();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.swap_horiz, size: 64, color: scheme.primary),
          const SizedBox(height: 16),
          Text(
            'No orders found',
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'P2P trade orders will appear here.',
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _P2PSkeleton extends StatelessWidget {
  const _P2PSkeleton();

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: 5,
      itemBuilder: (context, _) => Shimmer.fromColors(
        baseColor: base,
        highlightColor: Theme.of(context).colorScheme.surface,
        child: Card(
          margin: const EdgeInsets.only(bottom: 10),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(height: 16, width: 160, color: Colors.white),
                const SizedBox(height: 10),
                Container(height: 12, color: Colors.white),
                const SizedBox(height: 8),
                Container(height: 12, width: 120, color: Colors.white),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.cloud_off, size: 56, color: scheme.error),
          const SizedBox(height: 16),
          Text(message, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          FilledButton.tonalIcon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}
