import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:nostrfeed_mobile/core/theme/app_theme.dart';

/// Pins the Primal-inspired engagement palette: the exact hex values from
/// Primal's `extraColorScheme`, plus WCAG contrast of the ACTIVE icon/text
/// color against the app's surfaces (these colors sit on `surface` in the
/// action row).
void main() {
  group('AppActionColors', () {
    test('zap is Primal orange in both modes', () {
      expect(AppActionColors.zap, const Color(0xFFFFA02F));
    });

    test('bookmark is Primal blue in both modes', () {
      expect(AppActionColors.bookmark, const Color(0xFF0090F8));
    });

    test('like matches Primal liked pink per mode', () {
      expect(AppActionColors.like(Brightness.dark), const Color(0xFFF800C1));
      expect(AppActionColors.like(Brightness.light), const Color(0xFFCA079F));
    });

    test('repost: Primal green on dark, AA-passing leaf green on light', () {
      // Dark is Primal's exact `reposted` value; light is darkened because
      // Primal's own `#52CE0A` is ~2:1 on white (far below WCAG AA).
      expect(AppActionColors.repost(Brightness.dark), const Color(0xFF66E205));
      expect(AppActionColors.repost(Brightness.light), const Color(0xFF4E9A06));
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
      const surface = Color(0xFFF7FAFD); // AppTheme light surface
      expect(contrast(AppActionColors.like(Brightness.light), surface),
          greaterThan(3.0));
      expect(contrast(AppActionColors.repost(Brightness.light), surface),
          greaterThan(3.0));
      expect(contrast(AppActionColors.bookmark, surface), greaterThan(3.0));
    });

    test('dark-mode accents pass AA on the dark surface', () {
      const surface = Color(0xFF0B0F14); // AppTheme dark surface
      expect(contrast(AppActionColors.like(Brightness.dark), surface),
          greaterThan(4.5));
      expect(contrast(AppActionColors.repost(Brightness.dark), surface),
          greaterThan(4.5));
      expect(contrast(AppActionColors.bookmark, surface), greaterThan(4.5));
      expect(contrast(AppActionColors.zap, surface), greaterThan(4.5));
    });
  });
}
