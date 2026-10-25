import 'package:flutter/material.dart';

import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';

/// Count badge — the small circular counter on the bottom-nav chat tab and
/// the notifications bell. Centralizes the "99+" cap + 9sp bold styling that
/// was previously copy-pasted inline.
///
/// ```dart
/// AppBadge.count(
///   count: unread,
///   child: Icon(Icons.chat_bubble_outline),
/// )
/// ```
class AppBadge extends StatelessWidget {
  const AppBadge.count({
    super.key,
    required this.count,
    required this.child,
    this.max = 99,
    this.color,
    this.textColor,
  });

  /// Unread count. Values ≤ 0 hide the badge entirely.
  final int count;

  /// The widget the badge anchors to (usually an icon).
  final Widget child;

  /// Cap — counts above this render as "{max}+".
  final int max;

  /// Badge background. Defaults to `colorScheme.error` (attention red).
  final Color? color;

  /// Badge text color. Defaults to `colorScheme.onError`.
  final Color? textColor;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Badge(
      isLabelVisible: count > 0,
      label: Text(
        count > max ? '$max+' : '$count',
        style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold),
      ),
      backgroundColor: color ?? scheme.error,
      textColor: textColor ?? scheme.onError,
      child: child,
    );
  }
}

/// Status pill — a small labeled chip for entity states (live / upcoming /
/// ended / pending / active / expired). Centralizes the pill shape +
/// 11sp bold label previously hand-rolled per screen.
///
/// ```dart
/// StatusBadge(label: 'LIVE', color: AppStatusColors.error)
/// StatusBadge.success('Active')
/// ```
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    super.key,
    required this.label,
    required this.color,
    this.filled = true,
  });

  /// Success state (active, paid, online).
  const StatusBadge.success(this.label, {super.key, this.filled = true})
      : color = const Color(0xFF34A853); // AppStatusColors.success

  /// Warning state (expiring soon, pending).
  const StatusBadge.warning(this.label, {super.key, this.filled = true})
      : color = const Color(0xFFFB8C00); // AppStatusColors.warning

  /// Error / attention state (live now, expired, failed).
  const StatusBadge.error(this.label, {super.key, this.filled = true})
      : color = const Color(0xFFE53935); // AppStatusColors.error

  /// Informational state (upcoming, scheduled).
  const StatusBadge.info(this.label, {super.key, this.filled = true})
      : color = const Color(0xFF1E88E5); // AppStatusColors.info

  /// Badge text (uppercase by convention: "LIVE", "ENDED").
  final String label;

  /// Accent color. Use the named constructors for standard states.
  final Color color;

  /// Filled (solid background, white text — default) vs outlined.
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.xs,
        vertical: AppSpacing.xxs,
      ),
      decoration: BoxDecoration(
        color: filled ? color : Colors.transparent,
        borderRadius: AppShapes.radiusSm,
        border: filled ? null : Border.all(color: color),
      ),
      child: Text(
        label,
        style: textTheme.labelSmall?.copyWith(
          color: filled ? Colors.white : color,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}
