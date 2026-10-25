import 'package:flutter/foundation.dart'
    show TargetPlatform, debugDefaultTargetPlatformOverride;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/services/background_sync.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';
import 'package:workmanager_android/workmanager_android.dart';

/// workmanager 0.10 is a federated Pigeon plugin — there is no named
/// MethodChannel to stub, and in a unit test there is no platform
/// implementation at all. The supported seam is `WorkmanagerPlatform.instance`
/// (the same swap the plugin's own tests use): substitute a no-op fake so
/// `setEnabled` → `registerPeriodicSync`/`unregisterPeriodicSync` resolve
/// without the OS. We're testing the enabled flag, not the scheduler.
///
/// The fake MUST extend `WorkmanagerAndroid` (not the bare interface):
/// `Workmanager()`'s constructor runs `_ensurePlatformImplementation`,
/// which overwrites `WorkmanagerPlatform.instance` with the real impl
/// whenever it `is! WorkmanagerAndroid` — so a plain-interface fake gets
/// clobbered on the next `Workmanager()` call and the Pigeon channel throws.
class _FakeWorkmanagerPlatform extends WorkmanagerAndroid {
  int registered = 0;
  int cancelled = 0;

  @override
  Future<void> initialize(Function callbackDispatcher,
      {bool isInDebugMode = false}) async {}

  @override
  Future<void> registerPeriodicTask(
    String uniqueName,
    String taskName, {
    Duration? frequency,
    Duration? flexInterval,
    Map<String, dynamic>? inputData,
    Duration? initialDelay,
    Constraints? constraints,
    ExistingPeriodicWorkPolicy? existingWorkPolicy,
    BackoffPolicy? backoffPolicy,
    Duration? backoffPolicyDelay,
    String? tag,
    ForegroundServiceConfig? foregroundServiceConfig,
  }) async {
    registered++;
  }

  int oneOffs = 0;
  bool lastWasExpedited = false;
  bool lastHadForegroundConfig = false;

  @override
  Future<void> registerOneOffTask(
    String uniqueName,
    String taskName, {
    Map<String, dynamic>? inputData,
    Duration? initialDelay,
    Constraints? constraints,
    ExistingWorkPolicy? existingWorkPolicy,
    BackoffPolicy? backoffPolicy,
    Duration? backoffPolicyDelay,
    String? tag,
    OutOfQuotaPolicy? outOfQuotaPolicy,
    ForegroundServiceConfig? foregroundServiceConfig,
    bool expedited = false,
  }) async {
    oneOffs++;
    lastWasExpedited = expedited;
    lastHadForegroundConfig = foregroundServiceConfig != null;
  }

  @override
  Future<void> cancelByUniqueName(String uniqueName) async {
    cancelled++;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    WorkmanagerPlatform.instance = _FakeWorkmanagerPlatform();
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

  group('Phase 4: sync-window toggle (ADR-0007)', () {
    test('defaults to OFF (the opt-in heavier tier)', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final svc = container.read(backgroundSyncServiceProvider);
      expect(await svc.isWindowEnabled(), isFalse);
    });

    test('persists enable + disable', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final svc = container.read(backgroundSyncServiceProvider);

      await svc.setWindowEnabled(true);
      expect(await svc.isWindowEnabled(), isTrue);

      await svc.setWindowEnabled(false);
      expect(await svc.isWindowEnabled(), isFalse);
    });

    test('enabling schedules an expedited dataSync foreground task', () async {
      // flutter_test defaults defaultTargetPlatform to android, so the
      // schedule path runs against the fake platform.
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final svc = container.read(backgroundSyncServiceProvider);
      final fake = WorkmanagerPlatform.instance as _FakeWorkmanagerPlatform;

      final before = fake.oneOffs;
      await svc.setWindowEnabled(true);

      expect(await svc.isWindowEnabled(), isTrue);
      expect(fake.oneOffs, greaterThan(before)); // a window task was queued
      expect(fake.lastWasExpedited, isTrue);
      expect(fake.lastHadForegroundConfig, isTrue);
    });

    test('a fresh instance sees the persisted window flag', () async {
      final c1 = ProviderContainer();
      addTearDown(c1.dispose);
      await c1.read(backgroundSyncServiceProvider).setWindowEnabled(true);

      final c2 = ProviderContainer();
      addTearDown(c2.dispose);
      expect(
        await c2.read(backgroundSyncServiceProvider).isWindowEnabled(),
        isTrue,
      );
    });

    test('the window is a no-op off-Android (iOS guard)', () async {
      // Force the platform guard to the iOS branch.
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final svc = container.read(backgroundSyncServiceProvider);
      final fake = WorkmanagerPlatform.instance as _FakeWorkmanagerPlatform;
      final before = fake.oneOffs;

      // debugDefaultTargetPlatformOverride drives defaultTargetPlatform.
      // (kIsWeb is false in the VM, so this is the only override needed.)
      // ignore: invalid_use_of_visible_for_testing_member
      _overridePlatform(_P.ios);
      await svc.scheduleSyncWindow();
      _overridePlatform(null);
      expect(fake.oneOffs, before); // nothing scheduled on iOS
      // The window is reported as unsupported off-Android.
      _overridePlatform(_P.ios);
      expect(syncWindowSupported, isFalse);
      _overridePlatform(null);
    });
  });
}

// Thin wrappers so the test reads clearly.
enum _P { ios }

void _overridePlatform(_P? p) {
  // ignore: invalid_use_of_visible_for_testing_member
  debugDefaultTargetPlatformOverride =
      p == _P.ios ? TargetPlatform.iOS : null;
}
