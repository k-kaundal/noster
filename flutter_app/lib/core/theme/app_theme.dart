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

/// Per-action accent colors for the engagement row (Refined direction).
/// Inactive actions stay muted grey (`colorScheme.onSurfaceVariant`); these
/// colors only appear on the ACTIVE state — except zap, which keeps its
/// signature amber permanently as an invite. The Refined palette is MUTED
/// (not neon): value should feel present, never shout.
class AppActionColors {
  AppActionColors._();

  /// Zap — muted amber. Deep `#CC7008` on light (passes AA ≥3:1 on the
  /// whisper-grey surface), a softer `#F0A03C` on dark. Softer than Primal
  /// neon `#FFA02F` so value feels present, never shouts.
  ///
  /// NOTE: this is the FALLBACK const for `const Icon(..., color: zap)` call
  /// sites — prefer [zapFor] (brightness-aware) in new code. The const is the
  /// dark value, which reads on the dark surfaces where most zap rows live.
  static const Color zap = Color(0xFFF0A03C);

  /// Brightness-aware zap amber (AA on both surfaces).
  static Color zapFor(Brightness brightness) => brightness == Brightness.dark
      ? const Color(0xFFF0A03C)
      : const Color(0xFFCC7008);

  /// Bookmark — the brand accent, muted so it works in both modes.
  static const Color bookmark = Color(0xFF4A7FD6);

  /// Like — rose: `#D64B7F` on light (AA), `#E86FA0` on dark.
  /// (Was neon pink `#F800C1`/`#CA079F`.)
  static Color like(Brightness brightness) => brightness == Brightness.dark
      ? const Color(0xFFE86FA0)
      : const Color(0xFFD64B7F);

  /// Repost — green: `#2E9E63` on light (AA), `#45C182` on dark.
  /// (Was neon `#66E205`/`#4E9A06`.)
  static Color repost(Brightness brightness) => brightness == Brightness.dark
      ? const Color(0xFF45C182)
      : const Color(0xFF2E9E63);
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
  /// Light-mode brand: the Refined accent — one confident blue, AA on white.
  static const Color _brand = Color(0xFF2F6BFF);

  /// Dark-mode brand: a softer, brighter blue that reads on near-black.
  static const Color _brandDark = Color(0xFF6B96FF);

  /// The brand gradient (wallet cards, premium banners). Retired from
  /// identity — a subtle two-stop of the same accent, used sparingly.
  static const LinearGradient brandGradient = LinearGradient(
    colors: [Color(0xFF2F6BFF), Color(0xFF5B8AFF)],
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
      primaryContainer: Color(0xFFDEE8FF),
      onPrimaryContainer: Color(0xFF0A2A7A),
      // Secondary: a quiet neutral slate for secondary actions.
      secondary: Color(0xFF5B616E),
      onSecondary: Colors.white,
      secondaryContainer: Color(0xFFE4E7EC),
      onSecondaryContainer: Color(0xFF1B1E26),
      // Tertiary: the accent again (chat "mine" bubbles read as brand).
      tertiary: Color(0xFF2F6BFF),
      onTertiary: Colors.white,
      tertiaryContainer: Color(0xFFDEE8FF),
      onTertiaryContainer: Color(0xFF0A2A7A),
      // Errors
      error: Color(0xFFE53935),
      onError: Colors.white,
      errorContainer: Color(0xFFFFDAD4),
      onErrorContainer: Color(0xFF410002),
      // Surfaces: a whisper-grey page (#F7F8FA) so pure-white cards lift
      // with hairlines (Refined). Content carries the color; chrome is quiet.
      surface: Color(0xFFF7F8FA),
      onSurface: Color(0xFF16181D),
      onSurfaceVariant: Color(0xFF5B616E),
      // Hand-specified NEUTRAL container ladder (no blue tint) — lowest is
      // pure white so cards pop ABOVE the whisper-grey base.
      surfaceContainerLowest: Color(0xFFFFFFFF),
      surfaceContainerLow: Color(0xFFF9FAFC),
      surfaceContainer: Color(0xFFF4F5F8),
      surfaceContainerHigh: Color(0xFFEFF1F5),
      surfaceContainerHighest: Color(0xFFEBEEF3),
      surfaceDim: Color(0xFFE4E7EC),
      surfaceBright: Color(0xFFFFFFFF),
      outline: Color(0xFF9BA1AE),
      outlineVariant: Color(0xFFE8EAEF),
      shadow: Colors.black,
      scrim: Colors.black,
      inverseSurface: Color(0xFF23262F),
      onInverseSurface: Color(0xFFF1F2F6),
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
      onPrimary: Color(0xFF0A1B40),
      primaryContainer: Color(0xFF1A3A8F),
      onPrimaryContainer: Color(0xFFDEE8FF),
      secondary: Color(0xFFA2A8B5),
      onSecondary: Color(0xFF1B1E26),
      secondaryContainer: Color(0xFF2A2F3A),
      onSecondaryContainer: Color(0xFFE4E7EC),
      // Tertiary: the accent again (chat "mine" bubbles read as brand).
      tertiary: Color(0xFF6B96FF),
      onTertiary: Color(0xFF0A1B40),
      tertiaryContainer: Color(0xFF1A3A8F),
      onTertiaryContainer: Color(0xFFDEE8FF),
      error: Color(0xFFFF5449),
      onError: Color(0xFF690005),
      errorContainer: Color(0xFF93000A),
      onErrorContainer: Color(0xFFFFDAD4),
      // Refined dark — warm-neutral space, NOT blue-charcoal. Quiet ink
      // surfaces let the single accent carry identity.
      surface: Color(0xFF0E0F13),
      onSurface: Color(0xFFEDEEF2),
      onSurfaceVariant: Color(0xFFA2A8B5),
      // Hand-specified NEUTRAL container ladder.
      surfaceContainerLowest: Color(0xFF0A0C10),
      surfaceContainerLow: Color(0xFF12151B),
      surfaceContainer: Color(0xFF15171D),
      surfaceContainerHigh: Color(0xFF1B1E26),
      surfaceContainerHighest: Color(0xFF20242D),
      surfaceDim: Color(0xFF0A0C10),
      surfaceBright: Color(0xFF262B35),
      outline: Color(0xFF666D7C),
      outlineVariant: Color(0xFF23262F),
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
      onPrimary: Color(0xFF0A1B40),
      primaryContainer: Color(0xFF1A3A8F),
      onPrimaryContainer: Color(0xFFDEE8FF),
      secondary: Color(0xFFA2A8B5),
      onSecondary: Color(0xFF1B1E26),
      secondaryContainer: Color(0xFF2A2F3A),
      onSecondaryContainer: Color(0xFFE4E7EC),
      tertiary: Color(0xFF6B96FF),
      onTertiary: Color(0xFF0A1B40),
      tertiaryContainer: Color(0xFF1A3A8F),
      onTertiaryContainer: Color(0xFFDEE8FF),
      error: Color(0xFFFF5449),
      onError: Color(0xFF690005),
      errorContainer: Color(0xFF93000A),
      onErrorContainer: Color(0xFFFFDAD4),
      // True black base.
      surface: Color(0xFF000000),
      onSurface: Color(0xFFEDEEF2),
      onSurfaceVariant: Color(0xFFA2A8B5),
      // Container ladder re-based on black (neutral, not blue).
      surfaceContainerLowest: Color(0xFF000000),
      surfaceContainerLow: Color(0xFF0A0C10),
      surfaceContainer: Color(0xFF101318),
      surfaceContainerHigh: Color(0xFF151920),
      surfaceContainerHighest: Color(0xFF1C212A),
      surfaceDim: Color(0xFF000000),
      surfaceBright: Color(0xFF232932),
      outline: Color(0xFF666D7C),
      // Slightly deeper hairlines so they don't shimmer on true black.
      outlineVariant: Color(0xFF1F242D),
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
