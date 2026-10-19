import 'package:flutter/widgets.dart';

/// Design tokens for spacing. Use these instead of magic numbers so the
/// app stays visually consistent.
class AppSpacing {
  AppSpacing._();

  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 20;
  static const double xl = 24;
  static const double xxl = 32;

  // Common paddings
  static const EdgeInsets paddingXs = EdgeInsets.all(xs);
  static const EdgeInsets paddingSm = EdgeInsets.all(sm);
  static const EdgeInsets paddingMd = EdgeInsets.all(md);
  static const EdgeInsets paddingLg = EdgeInsets.all(lg);
  static const EdgeInsets paddingXl = EdgeInsets.all(xl);

  // Common gaps
  static const Widget gapXs = SizedBox(width: xs, height: xs);
  static const Widget gapSm = SizedBox(width: sm, height: sm);
  static const Widget gapMd = SizedBox(width: md, height: md);
  static const Widget gapLg = SizedBox(width: lg, height: lg);
  static const Widget gapXl = SizedBox(width: xl, height: xl);
}

/// Standardized network / relay timeouts. Replaces the magic
/// `Duration(seconds: 8/10/12/15/20/30)` values scattered across services.
class AppDurations {
  AppDurations._();

  /// Short query — single event by id, small lookups.
  static const Duration queryShort = Duration(seconds: 8);

  /// Default relay query timeout.
  static const Duration query = Duration(seconds: 10);

  /// Longer query — profile searches, aggregated fetches.
  static const Duration queryLong = Duration(seconds: 15);

  /// HTTP API calls (LNbits, Cashu mint, LNURL).
  static const Duration http = Duration(seconds: 10);

  /// HTTP calls that may be slow (invoice creation, uploads).
  static const Duration httpLong = Duration(seconds: 20);

  /// Wallet operations that poll or wait for payment.
  static const Duration walletOp = Duration(seconds: 30);
}
