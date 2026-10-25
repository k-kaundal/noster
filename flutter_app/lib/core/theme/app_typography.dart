import 'package:flutter/material.dart';

/// The app's type scale — ONE named ramp for the whole app.
///
/// Sizes follow the Material 3 ramp (so existing `textTheme.*` call sites
/// keep their layout), but every style is tuned for a social-feed product:
/// tighter line-heights for density, negative tracking on the big display
/// sizes (the modern Primal/X look), and deliberate weights so hierarchy
/// reads at a glance instead of everything being w400/w500 soup.
///
/// Deliberately NOT a bundled font: the platform face (SF Pro on iOS,
/// Roboto on Android) is what makes a 2026 app read "native" — ADR-0004
/// size budget stays intact and text always matches the OS. The design
/// lives in the sizes/weights/tracking, not the typeface.
///
/// Usage: `Theme.of(context).textTheme.titleMedium` — never a raw
/// `TextStyle(fontSize: 13)` in new code.
class AppTypography {
  AppTypography._();

  /// The full Material 3 [TextTheme], hand-tuned. Applied identically in
  /// light and dark (color comes from the scheme, never hardcoded here).
  static const TextTheme textTheme = TextTheme(
    // ── Display: marketing-scale, used by splash/empty states only ──
    displayLarge: TextStyle(
      fontSize: 57,
      height: 64 / 57,
      fontWeight: FontWeight.w700,
      letterSpacing: -1.4,
    ),
    displayMedium: TextStyle(
      fontSize: 45,
      height: 52 / 45,
      fontWeight: FontWeight.w700,
      letterSpacing: -1.0,
    ),
    displaySmall: TextStyle(
      fontSize: 36,
      height: 44 / 36,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.7,
    ),

    // ── Headline: screen titles, section heroes ──
    headlineLarge: TextStyle(
      fontSize: 32,
      height: 40 / 32,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.6,
    ),
    headlineMedium: TextStyle(
      fontSize: 28,
      height: 36 / 28,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.5,
    ),
    headlineSmall: TextStyle(
      fontSize: 24,
      height: 32 / 24,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.4,
    ),

    // ── Title: card headers, list primaries, sheet titles ──
    titleLarge: TextStyle(
      fontSize: 22,
      height: 28 / 22,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.3,
    ),
    titleMedium: TextStyle(
      fontSize: 16,
      height: 24 / 16,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.1,
    ),
    titleSmall: TextStyle(
      fontSize: 14,
      height: 20 / 14,
      fontWeight: FontWeight.w600,
      letterSpacing: 0,
    ),

    // ── Body: post content, descriptions — the reading experience ──
    bodyLarge: TextStyle(
      fontSize: 16,
      height: 24 / 16,
      fontWeight: FontWeight.w400,
      letterSpacing: 0,
    ),
    bodyMedium: TextStyle(
      fontSize: 14,
      height: 21 / 14,
      fontWeight: FontWeight.w400,
      letterSpacing: 0.1,
    ),
    bodySmall: TextStyle(
      fontSize: 12,
      height: 16.5 / 12,
      fontWeight: FontWeight.w400,
      letterSpacing: 0.2,
    ),

    // ── Label: buttons, chips, badges, timestamps, metadata ──
    labelLarge: TextStyle(
      fontSize: 14,
      height: 20 / 14,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.1,
    ),
    labelMedium: TextStyle(
      fontSize: 12,
      height: 16 / 12,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.3,
    ),
    labelSmall: TextStyle(
      fontSize: 11,
      height: 15 / 11,
      fontWeight: FontWeight.w500,
      letterSpacing: 0.4,
    ),
  );

  /// Apply this theme to a [ColorScheme]-aware [ThemeData]. Colors come
  /// from the scheme — the ramp itself never sets a color, so light/dark
  /// stay correct by construction.
  static TextTheme applyTo(TextTheme base) => textTheme;
}
