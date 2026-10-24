import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/boost/application/boost_providers.dart';
import 'package:nostrfeed_mobile/features/boost/application/boost_purchase.dart';
import 'package:nostrfeed_mobile/features/boost/domain/boost.dart';

/// The boost purchase sheet: pick a tier, pay sats, the boost goes live
/// when the platform's zap receipt lands on relays.
Future<void> showBoostSheet(BuildContext context, NostrEvent event) {
  return AppSheet.show(context, child: _BoostSheet(event: event));
}

class _BoostSheet extends ConsumerStatefulWidget {
  final NostrEvent event;

  const _BoostSheet({required this.event});

  @override
  ConsumerState<_BoostSheet> createState() => _BoostSheetState();
}

class _BoostSheetState extends ConsumerState<_BoostSheet> {
  BoostTier _selected = boostTiers[1]; // Growth is the sensible default

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final purchase = ref.watch(boostPurchaseProvider);

    // React to terminal states.
    ref.listen(boostPurchaseProvider, (_, next) {
      if (next.stage == BoostPurchaseStage.done) {
        Navigator.of(context).pop();
        AppToast.success(
          context,
          next.error ?? '⚡ Boosted for ${_durationLabel(_selected)}!',
        );
        ref.read(boostPurchaseProvider.notifier).reset();
      } else if (next.stage == BoostPurchaseStage.failed) {
        AppToast.error(context, next.error ?? 'Boost failed');
        ref.read(boostPurchaseProvider.notifier).reset();
      }
    });

    final busy = purchase.stage != BoostPurchaseStage.idle;

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
                    'Boost this post',
                    style: theme.textTheme.titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: busy ? null : () => Navigator.of(context).pop(),
                ),
              ],
            ),
            Text(
              'Pay sats to show this post to more NostrFeed readers, for a '
              'limited time. The payment is a public zap to the platform — '
              'anyone can verify it on relays. No refunds.',
              style: TextStyle(
                fontSize: 13,
                color: scheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 16),
            for (final tier in boostTiers) ...[
              _TierTile(
                tier: tier,
                selected: tier.code == _selected.code,
                onTap: busy ? null : () => setState(() => _selected = tier),
              ),
              const SizedBox(height: 10),
            ],
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: busy
                  ? null
                  : () => ref
                      .read(boostPurchaseProvider.notifier)
                      .buy(widget.event, _selected),
              icon: busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.rocket_launch_rounded),
              label: Text(
                busy
                    ? _busyLabel(purchase.stage)
                    : 'Boost for ${_selected.priceSats} sats',
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Boosted posts are labeled “Boosted”, capped at 10% of any '
              'feed, and never bypass content filters. Boosts lift posts '
              'for NostrFeed readers — other clients see an ordinary zap.',
              style: TextStyle(
                fontSize: 11,
                color: scheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _durationLabel(BoostTier tier) {
    final days = tier.duration.inDays;
    return days == 1 ? '24 hours' : '$days days';
  }

  String _busyLabel(BoostPurchaseStage stage) => switch (stage) {
        BoostPurchaseStage.resolving => 'Preparing…',
        BoostPurchaseStage.paying => 'Paying…',
        BoostPurchaseStage.awaitingReceipt => 'Confirming on relays…',
        _ => 'Working…',
      };
}

class _TierTile extends StatelessWidget {
  final BoostTier tier;
  final bool selected;
  final VoidCallback? onTap;

  const _TierTile({
    required this.tier,
    required this.selected,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final days = tier.duration.inDays;

    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(14),
          border: selected
              ? Border.all(color: scheme.primary, width: 1.5)
              : null,
        ),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked_rounded
                  : Icons.radio_button_off_rounded,
              size: 20,
              color: selected ? scheme.primary : scheme.onSurfaceVariant,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    tier.label,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                  ),
                  Text(
                    '${days == 1 ? '24 hours' : '$days days'} · '
                    '${tier.multiplier}× visibility',
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.bolt_rounded, size: 15, color: scheme.primary),
                Text(
                  '${tier.priceSats}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
