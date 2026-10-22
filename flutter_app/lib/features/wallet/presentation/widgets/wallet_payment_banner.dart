import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/app/router.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_live_providers.dart';

/// In-app banner for realtime LNbits payments: "⚡ Received 500 sats".
/// Sits above every route (MaterialApp.builder), auto-dismisses, tap →
/// opens the wallet. The local push notification covers the background
/// case; this covers the app-open case.
class WalletPaymentBanner extends ConsumerWidget {
  const WalletPaymentBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final payment = ref.watch(lnbitsLiveAlertProvider);
    if (payment == null) return const SizedBox.shrink();

    final colorScheme = Theme.of(context).colorScheme;
    final sats = (payment.amountMsat ?? 0) ~/ 1000;
    final memo = payment.memo;

    // Auto-dismiss after a few seconds (only if not replaced by a newer one).
    Future.delayed(const Duration(seconds: 4), () {
      if (identical(ref.read(lnbitsLiveAlertProvider), payment)) {
        ref.read(lnbitsLiveAlertProvider.notifier).state = null;
      }
    });

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Material(
          elevation: 8,
          borderRadius: BorderRadius.circular(16),
          color: colorScheme.surfaceContainerHigh,
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () {
              ref.read(lnbitsLiveAlertProvider.notifier).state = null;
              // Banner lives ABOVE the router — navigate via routerProvider.
              ref.read(routerProvider).push('/wallet');
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: Colors.amber.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.bolt_rounded,
                      color: Colors.amber,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      memo != null && memo.isNotEmpty
                          ? 'Received $sats sats — $memo'
                          : 'Received $sats sats',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                        height: 1.25,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
