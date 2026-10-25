import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// The Refined icon system — one family of 24-viewBox stroke icons
/// (1.75px stroke, round caps/joins), rendered via [SvgPicture] and
/// recolored with a [BlendMode.srcIn] color filter so every icon inherits
/// the intended color. Replaces the Material-icons + inline-emoji mix in
/// UI chrome. Assets live in `assets/icons/<name>.svg`.
///
/// Sizes: use the [AppIconSize] tokens (xs 13 / sm 16 / md 18 / lg 21 /
/// xl 24) so the stroke reads consistently at every scale — never a raw
/// magic number.
class AppIcon extends StatelessWidget {
  const AppIcon(
    this.name, {
    super.key,
    this.size = AppIconSize.lg,
    this.color,
  });

  /// Icon asset name without extension (e.g. `'home'`, `'zap_filled'`).
  final String name;

  /// Rendered size in logical pixels — an [AppIconSize] token.
  final double size;

  /// Icon color. Null inherits [IconTheme]'s color.
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final effectiveColor = color ?? IconTheme.of(context).color;
    return SvgPicture.asset(
      'assets/icons/$name.svg',
      width: size,
      height: size,
      colorFilter: effectiveColor != null
          ? ColorFilter.mode(effectiveColor, BlendMode.srcIn)
          : null,
    );
  }
}

/// Icon size tokens — match the stroke to the scale.
class AppIconSize {
  AppIconSize._();

  /// 13 — inline with 11-12px text (timestamps, chips, stat rows).
  static const double xs = 13;

  /// 16 — post action row, compact buttons.
  static const double sm = 16;

  /// 18 — list rows, sheet actions.
  static const double md = 18;

  /// 21 — bottom navigation, app-bar actions.
  static const double lg = 21;

  /// 24 — feature emphasis (empty states, hero actions).
  static const double xl = 24;
}
