import 'package:flutter/material.dart';

/// The app's motion language: durations, curves and staggers every
/// animation uses, so the whole app feels like ONE designer made it.
///
/// Rules (from the UX plan):
/// - Micro-interactions (button pops, badge changes) use [fast].
/// - Entrances, transitions and most state changes use [normal].
/// - Big moves (sheets, full-screen reveals) use [slow].
/// - List entrances stagger by [stagger] per item — enough to read as
///   "items arriving", never so slow the user waits on the animation.
class AppMotion {
  AppMotion._();

  /// 150 ms — button pops, like/zap taps, badge/count changes.
  static const fast = Duration(milliseconds: 150);

  /// 300 ms — the default for entrances, transitions, state changes.
  static const normal = Duration(milliseconds: 300);

  /// 450 ms — big moves: sheets, full-screen reveals, hero moments.
  static const slow = Duration(milliseconds: 450);

  /// The default easing — decelerate (fast in, gentle settle).
  static const curve = Curves.easeOutCubic;

  /// Emphasis easing for pops (slight overshoot) — used on like/zap taps.
  static const curveEmphasis = Curves.easeOutBack;

  /// Per-item delay for list entrances (30 ms).
  static const stagger = Duration(milliseconds: 30);
}
