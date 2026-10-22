import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/auth_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/pay_invoice_sheet.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_credits.dart';

/// AI credits top-up: pick a pack → house-wallet invoice → pay with any
/// wallet (via the shared pay sheet) → LNbits confirms → credits land.
Future<void> showAiTopUpSheet(BuildContext context) {
  return AppSheet.show(context, child: const _AiTopUpSheet());
}

class _AiTopUpSheet extends ConsumerWidget {
  const _AiTopUpSheet();

  Future<void> _buyPack(BuildContext context, WidgetRef ref, AiCreditPack pack) async {
    final service = ref.read(aiCreditsServiceProvider);
    if (!service.canTopUp) {
      AppToast.error(
        context,
        'Top-up is not available in this build (no house wallet configured).',
      );
      return;
    }

    // Close the pack picker before opening the pay sheet.
    Navigator.of(context).pop();

    try {
      final pubkey = ref.read(authStateProvider).pubkey ?? 'anonymous';
      final invoice = await service.createTopUpInvoice(
        pack,
        buyerPubkey:
            pubkey.length > 12 ? pubkey.substring(0, 12) : pubkey,
      );
      if (!context.mounted) return;

      final result = await showPayInvoiceSheet(
        context,
        title: 'AI credits — ${pack.label}',
        bolt11: invoice.bolt11,
        amountSats: pack.sats,
        memo: pack.bonusCredits > 0
            ? '+${pack.bonusCredits} bonus credits'
            : null,
        checkPaid: () => service.checkTopUpPaid(invoice),
      );

      if (!context.mounted) return;
      if (result == InvoicePayResult.paid) {
        await ref.read(aiCreditsProvider.notifier).creditPayment(
          invoice.pack.creditsGranted,
          invoice.paymentHash,
        );
        if (!context.mounted) return;
        AppToast.success(
          context,
          '${invoice.pack.creditsGranted} AI credits added',
        );
      }
    } catch (e) {
      if (!context.mounted) return;
      AppToast.error(context, 'Could not create the invoice: $e');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final balance = ref.watch(aiCreditsProvider).value?.balance ?? 0;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'AI credits',
                    style: theme.textTheme.titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            Text(
              'Balance: $balance credits · 1 credit = 1 sat of AI',
              style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            for (final pack in aiCreditPacks) ...[
              _PackTile(pack: pack, onTap: () => _buyPack(context, ref, pack)),
              const SizedBox(height: 10),
            ],
            const SizedBox(height: 6),
            Text(
              'Paid in sats over Lightning to NostrFeed. Credits live on this '
              'device and are spent per AI message.',
              style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _PackTile extends StatelessWidget {
  final AiCreditPack pack;
  final VoidCallback onTap;

  const _PackTile({required this.pack, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(14),
          border: pack.bonusCredits > 0
              ? Border.all(color: scheme.primary, width: 1.5)
              : null,
        ),
        child: Row(
          children: [
            Icon(Icons.bolt_rounded, color: scheme.primary),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    pack.label,
                    style: theme.textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  Text(
                    pack.bonusCredits > 0
                        ? '${pack.creditsGranted} credits (+${pack.bonusCredits} bonus)'
                        : '${pack.creditsGranted} credits',
                    style: TextStyle(
                      fontSize: 12,
                      color: pack.bonusCredits > 0
                          ? scheme.primary
                          : scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, color: scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}
