import 'package:flutter/widgets.dart';

/// Shape tokens — the app's corner-radius ramp.
///
/// One dial for the app's "roundness character". Replaces the 15 different
/// hardcoded radii (2, 4, 6, 8, 10, 12, 14, 15, 16, 18, 20, 22, 24, 28)
/// that were scattered across screens. Map old values to the nearest
/// token; introduce a new radius only by extending THIS list.
///
/// The ramp is Material 3's shape scale, which the component themes in
/// `AppTheme` also follow (buttons/inputs = md, cards = lg, sheets = xl).
class AppShapes {
  AppShapes._();

  /// 4 — tight chips, tiny badges, hairline elements.
  static const double xs = 4;

  /// 8 — small tiles, thumbnails, indicator pills.
  static const double sm = 8;

  /// 12 — buttons, inputs, small cards (M3 `medium`).
  static const double md = 12;

  /// 16 — cards, dialogs, drawer items (M3 `large`).
  static const double lg = 16;

  /// 20 — bottom sheets, large surfaces (M3 `extraLarge`).
  static const double xl = 20;

  /// 28 — the floating bottom-nav pill and other stadium shapes.
  static const double pill = 28;

  // ── BorderRadius getters (the common case) ──

  static BorderRadius get radiusXs => BorderRadius.circular(xs);
  static BorderRadius get radiusSm => BorderRadius.circular(sm);
  static BorderRadius get radiusMd => BorderRadius.circular(md);
  static BorderRadius get radiusLg => BorderRadius.circular(lg);
  static BorderRadius get radiusXl => BorderRadius.circular(xl);
  static BorderRadius get radiusPill => BorderRadius.circular(pill);

  /// Stadium/capsule shape (fully rounded ends) — tags, pills, bubbles.
  static BorderRadius get radiusFull => BorderRadius.circular(999);
}
