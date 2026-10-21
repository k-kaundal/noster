import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/nostr/zap_receipts.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/pay_invoice_sheet.dart';
import 'package:nostrfeed_mobile/features/memberships/providers/membership_providers.dart';
import 'package:nostrfeed_mobile/features/studio/models/subscription.dart';

/// What a creator asks for, and where the reader stands on it.
///
/// Subscribing is a zap to the tier — the invoice flow here produces the
/// receipt that *is* the subscription, readable later by anybody.
class TierCard extends ConsumerStatefulWidget {
  final Tier tier;
  final bool isSelf;

  const TierCard({super.key, required this.tier, this.isSelf = false});

  @override
  ConsumerState<TierCard> createState() => _TierCardState();
}

class _TierCardState extends ConsumerState<TierCard> {
  bool _busy = false;

  Future<void> _subscribe() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final bolt11 = await ref.read(subscribeInvoiceProvider)(widget.tier);
      if (!mounted) return;
      if (bolt11 == null) {
        AppToast.error(
          context,
          'This creator cannot be zapped (no lightning address that accepts zaps).',
        );
        return;
      }

      final result = await showPayInvoiceSheet(
        context,
        title: 'Subscribe to ${widget.tier.title}',
        bolt11: bolt11,
        amountSats: widget.tier.amount,
        memo: 'per ${describeCadence(widget.tier.cadence)}',
        checkPaid: _receiptSeen,
      );
      if (!mounted) return;
      if (result == InvoicePayResult.paid) {
        AppToast.success(context, 'Subscribed — thank you!');
        ref.invalidate(mySubscriptionProvider(widget.tier));
        ref.invalidate(tierStandingProvider(widget.tier));
      }
    } catch (e) {
      if (mounted) AppToast.error(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Confirmation comes from the network, not a local record: the receipt
  /// the creator's lightning server publishes naming this tier and us.
  Future<bool> Function() get _receiptSeen {
    return () async {
      final auth = ref.read(authStateProvider);
      final me = auth.pubkey;
      if (me == null) return false;
      try {
        final receipts =
            await ref.read(membershipServiceProvider).fetchTierReceipts(widget.tier);
        final summary = summarizeZaps(
          receipts,
          check: ReceiptCheck(
            address: [tierAddress(widget.tier)],
            recipientPubkey: [widget.tier.creator],
          ),
        );
        return summary.zappers.any((z) => z.pubkey == me);
      } catch (_) {
        return false;
      }
    };
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final auth = ref.watch(authStateProvider);
    final status = widget.isSelf
        ? SubscriptionStatus.none
        : ref.watch(mySubscriptionProvider(widget.tier)).valueOrNull ??
            SubscriptionStatus.none;

    final active = status.state == SubscriptionState.active;
    final lapsed = status.state == SubscriptionState.lapsed;

    return Card(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: active
            ? BorderSide(color: scheme.primary, width: 1.5)
            : BorderSide.none,
      ),
      child: Padding(
        padding: AppSpacing.paddingMd,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    widget.tier.title,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                if (active)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: scheme.primaryContainer,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'ACTIVE',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: scheme.onPrimaryContainer,
                      ),
                    ),
                  ),
              ],
            ),
            AppSpacing.gapXs,
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Icon(Icons.bolt, size: 18, color: scheme.primary),
                Text(
                  _format(widget.tier.amount),
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: scheme.primary,
                  ),
                ),
                Text(
                  ' sats/${describeCadence(widget.tier.cadence)}',
                  style:
                      TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
                ),
              ],
            ),
            if (widget.tier.description.isNotEmpty) ...[
              AppSpacing.gapSm,
              Text(
                widget.tier.description,
                style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
              ),
            ],
            if (widget.tier.perks.isNotEmpty) ...[
              AppSpacing.gapSm,
              for (final perk in widget.tier.perks)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Icon(Icons.check_circle,
                          size: 16, color: scheme.primary),
                      AppSpacing.gapXs,
                      Expanded(
                        child: Text(perk, style: const TextStyle(fontSize: 13)),
                      ),
                    ],
                  ),
                ),
            ],
            AppSpacing.gapMd,
            if (!widget.isSelf && status.daysLeft != null && active)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  'Active · ${status.daysLeft} days left',
                  style: TextStyle(fontSize: 12, color: scheme.primary),
                ),
              ),
            if (!widget.isSelf && lapsed)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  'Lapsed — pay again for another ${describeCadence(widget.tier.cadence)}',
                  style:
                      TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                ),
              ),
            if (!widget.isSelf && status.shortfallSats > 0)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  'You sent ${_format(status.totalSats)} sats — a period needs one payment of ${_format(widget.tier.amount)}.',
                  style: TextStyle(fontSize: 12, color: scheme.error),
                ),
              ),
            SizedBox(
              width: double.infinity,
              child: widget.isSelf
                  ? const SizedBox.shrink()
                  : FilledButton.icon(
                      onPressed: _busy || !auth.isLoggedIn ? null : _subscribe,
                      icon: _busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.bolt_rounded, size: 18),
                      label: Text(
                        active
                            ? 'Pay another ${describeCadence(widget.tier.cadence)}'
                            : lapsed
                                ? 'Renew'
                                : 'Subscribe · ${_format(widget.tier.amount)} sats',
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

String _format(int sats) {
  final s = sats.toString();
  final buf = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    final idx = s.length - i;
    buf.write(s[i]);
    if (idx > 1 && idx % 3 == 1) buf.write(',');
  }
  return buf.toString();
}
