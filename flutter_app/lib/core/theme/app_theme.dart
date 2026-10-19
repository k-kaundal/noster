import 'package:flutter/material.dart';

/// Status colors used across the app (relay status, sync state, etc.).
/// Centralized here instead of hardcoded `Colors.green/red/orange`
/// scattered across screens.
class AppStatusColors {
  AppStatusColors._();

  static const Color success = Color(0xFF4CAF50);
  static const Color warning = Color(0xFFFFA726);
  static const Color error = Color(0xFFEF5350);
  static const Color info = Color(0xFF42A5F5);
}

class AppTheme {
  static const _seedColor = Color(0xFF8B5CF6); // Violet (matching web app accent)

  /// The violet brand gradient used for wallet balance cards, premium
  /// banners, etc.
  static const LinearGradient brandGradient = LinearGradient(
    colors: [Color(0xFF1E88E5), Color(0xFF8E24AA)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static ThemeData get lightTheme {
    final scheme = ColorScheme.fromSeed(seedColor: _seedColor, brightness: Brightness.light);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      appBarTheme: const AppBarTheme(centerTitle: false, elevation: 0, scrolledUnderElevation: 1),
      cardTheme: const CardThemeData(elevation: 0, margin: EdgeInsets.symmetric(horizontal: 8, vertical: 4)),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
      dividerTheme: const DividerThemeData(space: 1, thickness: 0.5),
    );
  }

  static ThemeData get darkTheme {
    final scheme = ColorScheme.fromSeed(seedColor: _seedColor, brightness: Brightness.dark);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      appBarTheme: const AppBarTheme(centerTitle: false, elevation: 0, scrolledUnderElevation: 1),
      cardTheme: const CardThemeData(elevation: 0, margin: EdgeInsets.symmetric(horizontal: 8, vertical: 4)),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
      dividerTheme: const DividerThemeData(space: 1, thickness: 0.5),
    );
  }
}
