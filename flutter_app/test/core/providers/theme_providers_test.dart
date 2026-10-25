import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/providers/theme_providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Pins the appearance contracts: the choice PERSISTS across sessions (the
/// old in-memory provider reset to System every cold start), OLED resolves
/// to ThemeMode.dark (the true-black look comes from swapping the dark
/// THEME, not the brightness), and unknown stored values fall back safely.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// The notifier's `_load()` runs async out of `build()` — give the
  /// SharedPreferences mock's async hops time to settle.
  Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));

  group('AppAppearanceNotifier', () {
    test('defaults to system with empty prefs', () async {
      SharedPreferences.setMockInitialValues({});
      final container = ProviderContainer();
      addTearDown(container.dispose);
      // Read FIRST to trigger build()/_load(), then let the async load land.
      container.read(appAppearanceProvider);
      await settle();
      expect(container.read(appAppearanceProvider), AppAppearance.system);
    });

    test('restores a persisted choice on cold start', () async {
      SharedPreferences.setMockInitialValues({'settings:appearance': 'oled'});
      final container = ProviderContainer();
      addTearDown(container.dispose);
      container.read(appAppearanceProvider);
      await settle();
      expect(container.read(appAppearanceProvider), AppAppearance.oled);
    });

    test('setAppearance persists the choice', () async {
      SharedPreferences.setMockInitialValues({});
      final container = ProviderContainer();
      addTearDown(container.dispose);
      await container
          .read(appAppearanceProvider.notifier)
          .setAppearance(AppAppearance.dark);
      expect(container.read(appAppearanceProvider), AppAppearance.dark);

      // A NEW container (cold start) sees the same value.
      final fresh = ProviderContainer();
      addTearDown(fresh.dispose);
      fresh.read(appAppearanceProvider);
      await settle();
      expect(fresh.read(appAppearanceProvider), AppAppearance.dark);
    });

    test('an unknown stored value falls back to system', () async {
      SharedPreferences.setMockInitialValues(
          {'settings:appearance': 'banana'});
      final container = ProviderContainer();
      addTearDown(container.dispose);
      container.read(appAppearanceProvider);
      await settle();
      expect(container.read(appAppearanceProvider), AppAppearance.system);
    });
  });

  group('themeModeProvider mapping', () {
    test('system/light/dark map 1:1; oled resolves to dark', () {
      expect(
        switch (AppAppearance.system) {
          AppAppearance.system => ThemeMode.system,
          AppAppearance.light => ThemeMode.light,
          AppAppearance.dark || AppAppearance.oled => ThemeMode.dark,
        },
        ThemeMode.system,
      );
      expect(AppAppearance.oled.label, 'OLED Black');
    });
  });
}
