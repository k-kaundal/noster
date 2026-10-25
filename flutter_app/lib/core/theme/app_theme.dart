import 'package:flutter/material.dart';

import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_typography.dart';

/// Status colors used across the app (relay status, sync state, etc.).
/// Centralized here instead of hardcoded `Colors.green/red/orange`
/// scattered across screens.
class AppStatusColors {
  AppStatusColors._();

  static const Color success = Color(0xFF34A853);
  static const Color warning = Color(0xFFFB8C00);
  static const Color error = Color(0xFFE53935);
  static const Color info = Color(0xFF1E88E5);
}

/// Primal-inspired per-action accent colors for the engagement row —
/// the exact palette from Primal's `extraColorScheme` (zap orange, like
/// pink, repost green, bookmark blue). Inactive actions stay muted grey
/// (`colorScheme.onSurfaceVariant`); these colors only appear on the
/// ACTIVE state, except zap which keeps its signature orange as an invite.
class AppActionColors {
  AppActionColors._();

  /// Zap — Primal's signature orange (`zapped`), identical in both modes.
  static const Color zap = Color(0xFFFFA02F);

  /// Bookmark — Primal blue (`bookmarked`), identical in both modes.
  static const Color bookmark = Color(0xFF0090F8);

  /// Like — neon pink on dark (`#F800C1`), deeper magenta on light
  /// (`#CA079F`, passes WCAG AA on white).
  static Color like(Brightness brightness) => brightness == Brightness.dark
      ? const Color(0xFFF800C1)
      : const Color(0xFFCA079F);

  /// Repost — bright green on dark (`#66E205`, Primal's `reposted`), a
  /// deeper leaf green on light. Primal's own light value `#52CE0A` only
  /// reaches ~2:1 on white — far below WCAG AA — so the light value is
  /// darkened to `#4E9A06` (same hue family, >3:1 on ice-white).
  static Color repost(Brightness brightness) => brightness == Brightness.dark
      ? const Color(0xFF66E205)
      : const Color(0xFF4E9A06);
}

/// The app's color system — an **ice-blue** identity in the spirit of
/// Primal: a confident ocean-blue accent on clean, neutral surfaces.
///
/// Why: the violet-seed theme read "bluish-muddy" (M3's seed algorithm
/// skews violet→blue and picks its own murky surfaces), and the amber
/// Lightning pass was too yellow for the app's feel. The user direction is
/// Primal-like blue. These schemes are HAND-SPECIFIED (not
/// `ColorScheme.fromSeed`) so the surfaces and accent are exactly right in
/// both modes: crisp ice-white in light, deep ocean charcoal in dark.
///
/// **Surface containers are hand-specified too.** The `surfaceContainer*`
/// roles are used 130+ times across the UI (bottom-nav pill, sheets, cards,
/// drawers, chat bubbles). When they are not given explicitly, Flutter
/// computes them with its own tint algorithm — re-introducing the very
/// murk the hand-specified scheme exists to avoid. Each mode therefore
/// defines the full container ladder as deliberate steps away from its
/// base surface.
class AppTheme {
  /// Light-mode brand: a deep ocean blue (passes WCAG AA on white).
  static const Color _brand = Color(0xFF0A66C2);

  /// Dark-mode brand: a brighter ice blue that glows on near-black.
  static const Color _brandDark = Color(0xFF4FA3E8);

  /// The brand gradient (wallet cards, premium banners). Two stops of the
  /// same blue family so it reads as one brand.
  static const LinearGradient brandGradient = LinearGradient(
    colors: [Color(0xFF0A66C2), Color(0xFF3D9BE9)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // ── Light ───────────────────────────────────────────────────────────
  //
  // Container ladder (ice-white base #F7FAFD): lowest is pure white so
  // cards pop ABOVE the background; each step up gets a touch deeper. The
  // old computed tints picked a blue-grey band that fought the ice-white —
  // these stay in the same cool family as the surface.

  static ThemeData get lightTheme {
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: _brand,
      onPrimary: Colors.white,
      primaryContainer: Color(0xFFCFE7FB),
      onPrimaryContainer: Color(0xFF062A4D),
      // Secondary: a quiet slate blue for secondary actions.
      secondary: Color(0xFF4E5D6E),
      onSecondary: Colors.white,
      secondaryContainer: Color(0xFFD9E4EF),
      onSecondaryContainer: Color(0xFF14212E),
      // Tertiary: a teal-leaning accent for highlights.
      tertiary: Color(0xFF0E7C86),
      onTertiary: Colors.white,
      tertiaryContainer: Color(0xFFC2E8EA),
      onTertiaryContainer: Color(0xFF00272B),
      // Errors
      error: Color(0xFFE53935),
      onError: Colors.white,
      errorContainer: Color(0xFFFFDAD4),
      onErrorContainer: Color(0xFF410002),
      // Surfaces: cool ice-white, barely a hint of blue. Neutral chrome is
      // what lets content carry the color.
      surface: Color(0xFFF7FAFD),
      onSurface: Color(0xFF10161D),
      onSurfaceVariant: Color(0xFF47535F),
      // Hand-specified container ladder — the tint-free steps.
      surfaceContainerLowest: Color(0xFFFFFFFF),
      surfaceContainerLow: Color(0xFFF2F6FB),
      surfaceContainer: Color(0xFFEDF2F8),
      surfaceContainerHigh: Color(0xFFE9EFF6),
      surfaceContainerHighest: Color(0xFFE6ECF2),
      surfaceDim: Color(0xFFD6DEE7),
      surfaceBright: Color(0xFFFFFFFF),
      outline: Color(0xFF707C88),
      outlineVariant: Color(0xFFC3CDD7),
      shadow: Colors.black,
      scrim: Colors.black,
      inverseSurface: Color(0xFF2A3138),
      onInverseSurface: Color(0xFFEDF2F7),
      inversePrimary: _brandDark,
      surfaceTint: _brand,
    );
    return _base(scheme);
  }

  // ── Dark ────────────────────────────────────────────────────────────
  //
  // Container ladder (ocean-charcoal base #0B0F14): lowest steps DOWN to
  // near-black (menus/sheets recede), the higher containers step UP toward
  // the existing #222B34 chat-bubble/pill tone. Every step stays in the
  // cool blue-charcoal family — no purple-grey M3 computed tint.

  static ThemeData get darkTheme {
    const scheme = ColorScheme(
      brightness: Brightness.dark,
      primary: _brandDark,
      onPrimary: Color(0xFF06243F),
      primaryContainer: Color(0xFF0E3A5E),
      onPrimaryContainer: Color(0xFFD2E8FC),
      secondary: Color(0xFFB7C6D6),
      onSecondary: Color(0xFF232E3A),
      secondaryContainer: Color(0xFF3A4856),
      onSecondaryContainer: Color(0xFFD9E4EF),
      tertiary: Color(0xFF7FD1D8),
      onTertiary: Color(0xFF00363B),
      tertiaryContainer: Color(0xFF1E5056),
      onTertiaryContainer: Color(0xFFC2E8EA),
      error: Color(0xFFFF5449),
      onError: Color(0xFF690005),
      errorContainer: Color(0xFF93000A),
      onErrorContainer: Color(0xFFFFDAD4),
      // Deep ocean-charcoal surfaces (NOT grey-purple — that was the dark
      // murk). Cool near-black makes the ice blue glow, Primal-midnight
      // style.
      surface: Color(0xFF0B0F14),
      onSurface: Color(0xFFE3EAF1),
      onSurfaceVariant: Color(0xFFB6C2CE),
      // Hand-specified container ladder.
      surfaceContainerLowest: Color(0xFF05070A),
      surfaceContainerLow: Color(0xFF0E1319),
      surfaceContainer: Color(0xFF131920),
      surfaceContainerHigh: Color(0xFF1A212A),
      surfaceContainerHighest: Color(0xFF222B34),
      surfaceDim: Color(0xFF05070A),
      surfaceBright: Color(0xFF2C3641),
      outline: Color(0xFF8A97A3),
      outlineVariant: Color(0xFF414B55),
      shadow: Colors.black,
      scrim: Colors.black,
      inverseSurface: Color(0xFFE3EAF1),
      onInverseSurface: Color(0xFF2A3138),
      inversePrimary: _brand,
      surfaceTint: _brandDark,
    );
    return _base(scheme);
  }

  // ── OLED (true-black dark variant) ──────────────────────────────────
  //
  // Pure #000000 base for AMOLED screens: unlit pixels save battery and the
  // ice-blue accent glows harder against true black. Same ladder as dark,
  // re-based on black; containers keep enough lift that sheets/cards still
  // separate from the background. Selected via Settings → Appearance
  // (AppAppearance.oled), never automatic — some users find pure black
  // "smears" while scrolling on OLED, so it stays an opt-in.

  static ThemeData get oledTheme {
    const scheme = ColorScheme(
      brightness: Brightness.dark,
      primary: _brandDark,
      onPrimary: Color(0xFF06243F),
      primaryContainer: Color(0xFF0E3A5E),
      onPrimaryContainer: Color(0xFFD2E8FC),
      secondary: Color(0xFFB7C6D6),
      onSecondary: Color(0xFF232E3A),
      secondaryContainer: Color(0xFF3A4856),
      onSecondaryContainer: Color(0xFFD9E4EF),
      tertiary: Color(0xFF7FD1D8),
      onTertiary: Color(0xFF00363B),
      tertiaryContainer: Color(0xFF1E5056),
      onTertiaryContainer: Color(0xFFC2E8EA),
      error: Color(0xFFFF5449),
      onError: Color(0xFF690005),
      errorContainer: Color(0xFF93000A),
      onErrorContainer: Color(0xFFFFDAD4),
      // True black base.
      surface: Color(0xFF000000),
      onSurface: Color(0xFFE3EAF1),
      onSurfaceVariant: Color(0xFFB6C2CE),
      // Container ladder re-based on black.
      surfaceContainerLowest: Color(0xFF000000),
      surfaceContainerLow: Color(0xFF090D11),
      surfaceContainer: Color(0xFF0F141A),
      surfaceContainerHigh: Color(0xFF171E26),
      surfaceContainerHighest: Color(0xFF202932),
      surfaceDim: Color(0xFF000000),
      surfaceBright: Color(0xFF2A343F),
      outline: Color(0xFF8A97A3),
      // Slightly deeper hairlines so they don't shimmer on true black.
      outlineVariant: Color(0xFF333D47),
      shadow: Colors.black,
      scrim: Colors.black,
      inverseSurface: Color(0xFFE3EAF1),
      onInverseSurface: Color(0xFF2A3138),
      inversePrimary: _brand,
      surfaceTint: _brandDark,
    );
    return _base(scheme);
  }

  // ── Shared component themes ─────────────────────────────────────────

  static ThemeData _base(ColorScheme scheme) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      // ONE type ramp for the whole app (colors come from the scheme).
      textTheme: AppTypography.textTheme,
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 1,
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        shape: RoundedRectangleBorder(borderRadius: AppShapes.radiusLg),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: AppShapes.radiusMd),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          shape: RoundedRectangleBorder(borderRadius: AppShapes.radiusMd),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape: RoundedRectangleBorder(borderRadius: AppShapes.radiusMd),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      dialogTheme: DialogThemeData(
        shape: RoundedRectangleBorder(borderRadius: AppShapes.radiusLg),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        showDragHandle: false,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppShapes.xl),
          ),
        ),
      ),
      snackBarTheme:
          const SnackBarThemeData(behavior: SnackBarBehavior.floating),
      dividerTheme: const DividerThemeData(space: 1, thickness: 0.5),
    );
  }
}
