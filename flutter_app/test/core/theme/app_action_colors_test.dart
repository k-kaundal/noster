import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:nostrfeed_mobile/core/theme/app_theme.dart';

/// Pins the Refined engagement palette: muted (not neon) accents, plus WCAG
/// contrast of the ACTIVE icon/text color against the app's surfaces (these
/// colors sit on `surface` in the action row). The Refined direction trades
/// Primal's neon for accents that read on both white and near-black.
void main() {
  group('AppActionColors', () {
    test('zap is muted amber per mode (AA on both surfaces)', () {
      expect(AppActionColors.zapFor(Brightness.dark), const Color(0xFFF0A03C));
      expect(AppActionColors.zapFor(Brightness.light), const Color(0xFFCC7008));
      // The const fallback is the dark value (used by const Icon call sites).
      expect(AppActionColors.zap, const Color(0xFFF0A03C));
    });

    test('bookmark is the muted brand blue in both modes', () {
      expect(AppActionColors.bookmark, const Color(0xFF4A7FD6));
    });

    test('like is rose per mode (muted from neon pink)', () {
      expect(AppActionColors.like(Brightness.dark), const Color(0xFFE86FA0));
      expect(AppActionColors.like(Brightness.light), const Color(0xFFD64B7F));
    });

    test('repost is green per mode (muted from neon)', () {
      expect(AppActionColors.repost(Brightness.dark), const Color(0xFF45C182));
      expect(AppActionColors.repost(Brightness.light), const Color(0xFF2E9E63));
    });

    // WCAG contrast ratio (relative luminance per the sRGB spec).
    double contrast(Color a, Color b) {
      double lum(Color c) {
        double channel(double v) => v <= 0.03928
            ? v / 12.92
            : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
        return 0.2126 * channel(c.r) +
            0.7152 * channel(c.g) +
            0.0722 * channel(c.b);
      }

      final l1 = lum(a);
      final l2 = lum(b);
      final hi = l1 > l2 ? l1 : l2;
      final lo = l1 > l2 ? l2 : l1;
      return (hi + 0.05) / (lo + 0.05);
    }

    // Action icons + counts are small but bold; 3:1 (AA large) is the floor,
    // and every accent should clear it comfortably on its own surface.
    test('light-mode accents pass AA on the light surface', () {
      final surface = AppTheme.lightTheme.colorScheme.surface;
      expect(contrast(AppActionColors.like(Brightness.light), surface),
          greaterThan(3.0));
      expect(contrast(AppActionColors.repost(Brightness.light), surface),
          greaterThan(3.0));
      expect(contrast(AppActionColors.bookmark, surface), greaterThan(3.0));
      expect(contrast(AppActionColors.zapFor(Brightness.light), surface),
          greaterThan(3.0));
    });

    test('dark-mode accents pass AA on the dark surface', () {
      final surface = AppTheme.darkTheme.colorScheme.surface;
      expect(contrast(AppActionColors.like(Brightness.dark), surface),
          greaterThan(4.5));
      expect(contrast(AppActionColors.repost(Brightness.dark), surface),
          greaterThan(4.5));
      expect(contrast(AppActionColors.bookmark, surface), greaterThan(4.5));
      expect(contrast(AppActionColors.zap, surface), greaterThan(4.5));
    });
  });
}
