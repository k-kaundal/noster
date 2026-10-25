import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/theme/app_typography.dart';

/// Pins the design-system contracts that keep the app looking hand-made:
///
/// 1. **Every `surfaceContainer*` role is explicitly specified** in all
///    three schemes (light/dark/OLED). If one is left to Flutter, its
///    tint algorithm computes it — re-introducing the murky blue-grey the
///    hand-specified schemes exist to avoid (the original complaint).
/// 2. The container ladders are MONOTONIC in the right direction (light:
///    lowest = lightest; dark: lowest = darkest) so cards/sheets separate
///    from the background in every mode.
/// 3. OLED is TRUE black — the AMOLED power-saving contract.
/// 4. Key text pairs pass WCAG AA in every mode.
/// 5. The TextTheme is a COMPLETE M3 ramp with the tuned tracking/heights.
void main() {
  // WCAG contrast ratio (relative luminance per the sRGB spec).
  double contrast(Color a, Color b) {
    double lum(Color c) {
      double channel(double v) =>
          v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
      return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    }

    final l1 = lum(a);
    final l2 = lum(b);
    final hi = math.max(l1, l2);
    final lo = math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  double luminance(Color c) {
    double channel(double v) =>
        v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }

  group('surface container roles are hand-specified', () {
    final schemes = {
      'light': AppTheme.lightTheme.colorScheme,
      'dark': AppTheme.darkTheme.colorScheme,
      'oled': AppTheme.oledTheme.colorScheme,
    };

    for (final entry in schemes.entries) {
      test('${entry.key}: all five container roles are deliberate', () {
        final s = entry.value;
        // Each role must be a deliberate step AWAY from the base surface —
        // an unspecified role collapses onto Flutter's computed tint, which
        // lands measurably close to `surface` with a blue-grey shift.
        // Exception: OLED's `surfaceContainerLowest` is INTENTIONALLY the
        // same true black as `surface` (menus recede into the black).
        if (entry.key != 'oled') {
          expect(s.surfaceContainerLowest, isNot(s.surface));
        }
        expect(s.surfaceContainerLow, isNot(s.surface));
        expect(s.surfaceContainer, isNot(s.surface));
        expect(s.surfaceContainerHigh, isNot(s.surface));
        expect(s.surfaceContainerHighest, isNot(s.surface));
      });
    }

    test('light ladder: lowest is lightest, highest is darkest', () {
      final s = AppTheme.lightTheme.colorScheme;
      expect(luminance(s.surfaceContainerLowest),
          greaterThan(luminance(s.surface)));
      expect(
          luminance(s.surfaceContainerHighest), lessThan(luminance(s.surfaceContainerLowest)));
      // Monotonic steps down the ladder.
      expect(luminance(s.surfaceContainerLowest),
          greaterThanOrEqualTo(luminance(s.surfaceContainerLow)));
      expect(luminance(s.surfaceContainerLow),
          greaterThanOrEqualTo(luminance(s.surfaceContainer)));
      expect(luminance(s.surfaceContainer),
          greaterThanOrEqualTo(luminance(s.surfaceContainerHigh)));
      expect(luminance(s.surfaceContainerHigh),
          greaterThanOrEqualTo(luminance(s.surfaceContainerHighest)));
    });

    test('dark ladder: lowest is darkest, highest is lightest', () {
      final s = AppTheme.darkTheme.colorScheme;
      expect(
          luminance(s.surfaceContainerLowest), lessThan(luminance(s.surface)));
      expect(luminance(s.surfaceContainerHighest),
          greaterThan(luminance(s.surface)));
      expect(luminance(s.surfaceContainerLowest),
          lessThanOrEqualTo(luminance(s.surfaceContainerLow)));
      expect(luminance(s.surfaceContainerLow),
          lessThanOrEqualTo(luminance(s.surfaceContainer)));
      expect(luminance(s.surfaceContainer),
          lessThanOrEqualTo(luminance(s.surfaceContainerHigh)));
      expect(luminance(s.surfaceContainerHigh),
          lessThanOrEqualTo(luminance(s.surfaceContainerHighest)));
    });
  });

  group('OLED theme', () {
    test('surface is true black', () {
      expect(AppTheme.oledTheme.colorScheme.surface, const Color(0xFF000000));
    });

    test('containers still lift above the black base', () {
      final s = AppTheme.oledTheme.colorScheme;
      // Sheets/cards must separate from the true-black background.
      expect(luminance(s.surfaceContainerHighest),
          greaterThan(luminance(s.surface)));
      expect(luminance(s.surfaceContainer), greaterThan(0));
    });

    test('dark and OLED share the brand accent', () {
      expect(AppTheme.oledTheme.colorScheme.primary,
          AppTheme.darkTheme.colorScheme.primary);
    });
  });

  group('WCAG AA text contrast', () {
    test('light: onSurface on surface ≥ 4.5', () {
      final s = AppTheme.lightTheme.colorScheme;
      expect(contrast(s.onSurface, s.surface), greaterThanOrEqualTo(4.5));
    });

    test('dark: onSurface on surface ≥ 4.5', () {
      final s = AppTheme.darkTheme.colorScheme;
      expect(contrast(s.onSurface, s.surface), greaterThanOrEqualTo(4.5));
    });

    test('oled: onSurface on surface ≥ 4.5', () {
      final s = AppTheme.oledTheme.colorScheme;
      expect(contrast(s.onSurface, s.surface), greaterThanOrEqualTo(4.5));
    });

    test('primary on its container passes in both modes', () {
      final light = AppTheme.lightTheme.colorScheme;
      final dark = AppTheme.darkTheme.colorScheme;
      expect(contrast(light.onPrimaryContainer, light.primaryContainer),
          greaterThanOrEqualTo(4.5));
      expect(contrast(dark.onPrimaryContainer, dark.primaryContainer),
          greaterThanOrEqualTo(4.5));
    });
  });

  group('AppTypography', () {
    test('the ramp is complete (all 15 M3 styles have sizes)', () {
      const t = AppTypography.textTheme;
      final styles = [
        t.displayLarge, t.displayMedium, t.displaySmall,
        t.headlineLarge, t.headlineMedium, t.headlineSmall,
        t.titleLarge, t.titleMedium, t.titleSmall,
        t.bodyLarge, t.bodyMedium, t.bodySmall,
        t.labelLarge, t.labelMedium, t.labelSmall,
      ];
      for (final style in styles) {
        expect(style, isNotNull);
        expect(style!.fontSize, isNotNull);
        expect(style.fontSize, greaterThan(0));
      }
    });

    test('sizes match the M3 ramp (no layout shock for existing call sites)', () {
      const t = AppTypography.textTheme;
      expect(t.displayLarge!.fontSize, 57);
      expect(t.headlineSmall!.fontSize, 24);
      expect(t.titleLarge!.fontSize, 22);
      expect(t.titleMedium!.fontSize, 16);
      expect(t.bodyLarge!.fontSize, 16);
      expect(t.bodyMedium!.fontSize, 14);
      expect(t.bodySmall!.fontSize, 12);
      expect(t.labelLarge!.fontSize, 14);
      expect(t.labelSmall!.fontSize, 11);
    });

    test('display/headline styles track tight (the designed look)', () {
      const t = AppTypography.textTheme;
      expect(t.displayLarge!.letterSpacing, lessThan(0));
      expect(t.headlineMedium!.letterSpacing, lessThan(0));
      expect(t.titleLarge!.letterSpacing, lessThan(0));
    });

    test('no style hardcodes a color (the scheme owns color)', () {
      const t = AppTypography.textTheme;
      for (final style in [
        t.displayLarge, t.headlineSmall, t.titleMedium,
        t.bodyLarge, t.bodyMedium, t.labelLarge,
      ]) {
        expect(style!.color, isNull);
      }
    });

    test('themes wire the ramp in', () {
      expect(AppTheme.lightTheme.textTheme.bodyMedium!.fontSize, 14);
      expect(AppTheme.darkTheme.textTheme.titleLarge!.letterSpacing, -0.3);
      expect(AppTheme.oledTheme.textTheme.bodySmall!.fontSize, 12);
    });
  });

  group('AppShapes', () {
    test('the ramp is strictly increasing', () {
      expect(AppShapes.xs, lessThan(AppShapes.sm));
      expect(AppShapes.sm, lessThan(AppShapes.md));
      expect(AppShapes.md, lessThan(AppShapes.lg));
      expect(AppShapes.lg, lessThan(AppShapes.xl));
      expect(AppShapes.xl, lessThan(AppShapes.pill));
    });

    test('border-radius getters match the tokens', () {
      expect(AppShapes.radiusMd, BorderRadius.circular(AppShapes.md));
      expect(AppShapes.radiusLg, BorderRadius.circular(AppShapes.lg));
      expect(AppShapes.radiusPill, BorderRadius.circular(AppShapes.pill));
    });
  });

  group('AppMotion', () {
    test('durations are ordered fast < normal < slow', () {
      expect(AppMotion.fast, lessThan(AppMotion.normal));
      expect(AppMotion.normal, lessThan(AppMotion.slow));
    });
  });
}
