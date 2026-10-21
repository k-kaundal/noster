import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:timeago/timeago.dart' as timeago;

import 'package:nostrfeed_mobile/features/wallet/services/lnbits_service.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/invoice_qr.dart';

// ── Payments list ────────────────────────────────────────────────────────

class PaymentsList extends ConsumerStatefulWidget {
  final String apiKey;

  const PaymentsList({super.key, required this.apiKey});

  @override
  ConsumerState<PaymentsList> createState() => _PaymentsListState();
}

class _PaymentsListState extends ConsumerState<PaymentsList> {
  List<LnbitsPayment>? _payments;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final service = LnbitsService();
      final payments = await service.getPayments(widget.apiKey);
      if (mounted) {
        setState(() {
          _payments = payments;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final formatter = NumberFormat('#,###');

    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline,
                  size: 48, color: colorScheme.error),
              const SizedBox(height: 12),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    if (_payments == null || _payments!.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt_long,
                size: 48, color: colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text('No payments yet',
                style: TextStyle(color: colorScheme.onSurfaceVariant)),
            const SizedBox(height: 4),
            Text(
              'Receive your first payment to see it here',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
                  ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: _payments!.length,
        separatorBuilder: (_, _) => const Divider(indent: 72),
        itemBuilder: (context, index) {
          final p = _payments![index];
          final isIncoming = p.isIncoming;
          final color = isIncoming ? Colors.green : colorScheme.error;

          return ListTile(
            // Pending incoming payments are tappable → re-show the QR so
            // the payer can still scan and complete the payment.
            onTap: p.isPending && isIncoming && p.bolt11 != null
                ? () => showInvoiceQrDialog(context, p.bolt11!)
                : null,
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(
                isIncoming ? Icons.arrow_downward : Icons.arrow_upward,
                color: color,
                size: 18,
              ),
            ),
            title: Text(
              '${isIncoming ? '+' : '-'}${formatter.format(p.amountSats)} sats',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
            subtitle: p.memo != null
                ? Text(p.memo!,
                    maxLines: 1, overflow: TextOverflow.ellipsis)
                : null,
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (p.timestampMs != null)
                  Text(
                    timeago.format(
                        DateTime.fromMillisecondsSinceEpoch(p.timestampMs!)),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                if (p.isPending)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.qr_code_rounded,
                          size: 12, color: Colors.orange.shade700),
                      const SizedBox(width: 3),
                      Text(
                        'Pending · tap for QR',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Colors.orange.shade700,
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                    ],
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Delegate to pin the TabBar.
class TabBarDelegate extends SliverPersistentHeaderDelegate {
  final TabBar tabBar;
  final Color backgroundColor;

  TabBarDelegate(this.tabBar, this.backgroundColor);

  @override
  double get minExtent => tabBar.preferredSize.height;
  @override
  double get maxExtent => tabBar.preferredSize.height;

  @override
  Widget build(
      BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(color: backgroundColor, child: tabBar);
  }

  @override
  bool shouldRebuild(TabBarDelegate oldDelegate) => false;
}
