import 'package:flutter/material.dart';

import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// The NostrFeed brand lockup — the gradient bolt tile + the two-tone
/// wordmark ("nostr" solid, "feed" in the brand primary).
///
/// One source of truth for the brand so the AppBar, drawer, login hero and
/// splash never drift apart.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.compact = false});

  /// `compact` renders only the bolt tile (no wordmark) — for tight spots.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final colorScheme = Theme.of(context).colorScheme;

    final tile = Container(
      width: 30,
      height: 30,
      decoration: BoxDecoration(
        gradient: AppTheme.brandGradient,
        borderRadius: AppShapes.radiusMd,
        boxShadow: [
          BoxShadow(
            color: colorScheme.primary.withValues(alpha: 0.35),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: const Center(
        child: AppIcon(
          'zap',
          size: 17,
          color: Colors.white, // token-guard: allow — on brand gradient
        ),
      ),
    );

    if (compact) return tile;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        tile,
        const SizedBox(width: 9),
        Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: 'nostr',
                style: textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.6,
                  color: colorScheme.onSurface,
                ),
              ),
              TextSpan(
                text: 'feed',
                style: textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.6,
                  color: colorScheme.primary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
