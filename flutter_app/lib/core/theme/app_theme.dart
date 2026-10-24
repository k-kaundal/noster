import 'package:flutter/material.dart';

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

/// The app's color system — an **ice-blue** identity in the spirit of
/// Primal: a confident ocean-blue accent on clean, neutral surfaces.
///
/// Why: the violet-seed theme read "bluish-muddy" (M3's seed algorithm
/// skews violet→blue and picks its own murky surfaces), and the amber
/// Lightning pass was too yellow for the app's feel. The user direction is
/// Primal-like blue. These schemes are HAND-SPECIFIED (not
/// `ColorScheme.fromSeed`) so the surfaces and accent are exactly right in
/// both modes: crisp ice-white in light, deep ocean charcoal in dark.
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
      surfaceContainerHighest: Color(0xFFE6ECF2),
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
      surfaceContainerHighest: Color(0xFF222B34),
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

  // ── Shared component themes ─────────────────────────────────────────

  static ThemeData _base(ColorScheme scheme) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 1,
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: const CardThemeData(
        elevation: 0,
        margin: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      snackBarTheme:
          const SnackBarThemeData(behavior: SnackBarBehavior.floating),
      dividerTheme: const DividerThemeData(space: 1, thickness: 0.5),
    );
  }
}
