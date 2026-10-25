import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/features/premium/application/premium_providers.dart';
import 'package:nostrfeed_mobile/features/premium/data/admission_service.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// The mark for paid relay admission, which is not a name tier.
///
/// Its own widget rather than part of the verified ✓, because it answers a
/// different question: a name says who somebody is; this says the paid relay
/// takes their writes. Somebody can have either without the other. Mirrors
/// the web app's `RelayMark` (ShieldCheck, zap colour).
///
/// Only ever renders on `admitted`. Unknown (nobody asked / the relay could
/// not be reached) and unpaid both render nothing — a failed check is not a
/// refusal, and neither is worth a mark.
class PaidRelayMark extends ConsumerWidget {
  final String pubkey;

  /// Icon size — 16–18 reads well next to a display name.
  final double size;
  const PaidRelayMark({super.key, required this.pubkey, this.size = 16});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final admission = ref.watch(relayAdmissionProvider(pubkey)).valueOrNull;
    if (admission != AdmissionState.admitted) return const SizedBox.shrink();

    const color = Color(0xFFF59E0B); // zap amber — same family as the web mark
    return Tooltip(
      message: 'Paid relay member — the paid relay accepts their writes.',
      child: Padding(
        padding: const EdgeInsets.only(left: 2),
        child: AppIcon('verified', size: size, color: color),
      ),
    );
  }
}

/// The same thing written out as a chip, for somewhere with room (the
/// profile header under the handle).
class PaidRelayBadge extends ConsumerWidget {
  final String pubkey;
  const PaidRelayBadge({super.key, required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final admission = ref.watch(relayAdmissionProvider(pubkey)).valueOrNull;
    if (admission != AdmissionState.admitted) return const SizedBox.shrink();

    const color = Color(0xFFF59E0B);
    return Tooltip(
      message: 'The paid relay accepts writes from this account.',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(999),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppIcon('verified', size: 12, color: color),
            SizedBox(width: 4),
            Text(
              'Paid member',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
