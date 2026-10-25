import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Storage key for the user's chosen appearance.
const _kAppearanceKey = 'settings:appearance';

/// The user's chosen app appearance. `oled` is a true-black variant of
/// dark mode for AMOLED screens — opt-in only (some OLED panels smear on
/// pure-black scroll, so it is never the automatic choice).
enum AppAppearance {
  system('System'),
  light('Light'),
  dark('Dark'),
  oled('OLED Black');

  final String label;
  const AppAppearance(this.label);

  static AppAppearance fromName(String? name) => AppAppearance.values
      .firstWhere((v) => v.name == name, orElse: () => AppAppearance.system);
}

/// The user's appearance choice, persisted to SharedPreferences so the app
/// cold-starts in the mode they picked (the old in-memory StateProvider
/// reset to System every launch).
final appAppearanceProvider =
    NotifierProvider<AppAppearanceNotifier, AppAppearance>(
  AppAppearanceNotifier.new,
);

class AppAppearanceNotifier extends Notifier<AppAppearance> {
  @override
  AppAppearance build() {
    _load();
    return AppAppearance.system;
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(_kAppearanceKey);
      if (stored != null && stored.isNotEmpty) {
        state = AppAppearance.fromName(stored);
      }
    } catch (_) {}
  }

  Future<void> setAppearance(AppAppearance appearance) async {
    state = appearance;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kAppearanceKey, appearance.name);
    } catch (_) {}
  }
}

/// Maps the appearance choice to Flutter's [ThemeMode]. `oled` resolves to
/// `ThemeMode.dark` — the OLED look is delivered by swapping the dark
/// THEME (see app.dart), not by a different brightness.
final themeModeProvider = Provider<ThemeMode>((ref) {
  return switch (ref.watch(appAppearanceProvider)) {
    AppAppearance.system => ThemeMode.system,
    AppAppearance.light => ThemeMode.light,
    AppAppearance.dark || AppAppearance.oled => ThemeMode.dark,
  };
});
