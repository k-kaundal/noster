import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/services/background_sync.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('BackgroundSyncService enabled flag', () {
    test('defaults to ON (the battery-cheap tier)', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final svc = container.read(backgroundSyncServiceProvider);
      expect(await svc.isEnabled(), isTrue);
    });

    test('persists an explicit disable + re-enable', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final svc = container.read(backgroundSyncServiceProvider);

      await svc.setEnabled(false);
      expect(await svc.isEnabled(), isFalse);

      await svc.setEnabled(true);
      expect(await svc.isEnabled(), isTrue);
    });

    test('a fresh service instance sees the persisted value', () async {
      final c1 = ProviderContainer();
      addTearDown(c1.dispose);
      await c1.read(backgroundSyncServiceProvider).setEnabled(false);

      // New container, same SharedPreferences store — simulates an app
      // restart reading the user's choice.
      final c2 = ProviderContainer();
      addTearDown(c2.dispose);
      expect(await c2.read(backgroundSyncServiceProvider).isEnabled(), isFalse);
    });
  });
}
