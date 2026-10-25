import 'package:flutter/material.dart';

import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';

/// The app's standard surface card — a flat (elevation 0) container on
/// `surfaceContainerLowest` with the `lg` radius, so content cards read as
/// one consistent surface across every screen.
///
/// Replaces the dozens of hand-rolled `Container(decoration: BoxDecoration(
/// color: colorScheme.surfaceContainerLowest, borderRadius:
/// BorderRadius.circular(N)))` blocks scattered across feature screens.
///
/// ```dart
/// AppCard(
///   onTap: () => context.push('/detail'),
///   child: ListTile(...),
/// )
/// ```
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = AppSpacing.paddingMd,
    this.margin,
    this.color,
    this.borderColor,
  });

  /// Card contents.
  final Widget child;

  /// Optional tap handler — renders ink ripple clipped to the card shape.
  final VoidCallback? onTap;

  /// Inner padding. Defaults to the standard [AppSpacing.paddingMd].
  final EdgeInsetsGeometry padding;

  /// Outer margin. Null by default (the parent list controls spacing).
  final EdgeInsetsGeometry? margin;

  /// Surface override. Defaults to `colorScheme.surfaceContainerLowest`.
  final Color? color;

  /// Optional 1px border color (e.g. `outlineVariant` for a hairline).
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final effectiveColor = color ?? scheme.surfaceContainerLowest;

    final decoration = BoxDecoration(
      color: effectiveColor,
      borderRadius: AppShapes.radiusLg,
      border: borderColor != null ? Border.all(color: borderColor!) : null,
    );

    final Widget body = Padding(padding: padding, child: child);

    return Container(
      margin: margin,
      decoration: decoration,
      child: onTap != null
          ? Material(
              type: MaterialType.transparency,
              child: InkWell(
                onTap: onTap,
                borderRadius: AppShapes.radiusLg,
                child: body,
              ),
            )
          : body,
    );
  }
}
