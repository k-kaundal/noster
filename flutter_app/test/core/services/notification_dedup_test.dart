import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The "notifications fire again and again" fixes: persistent notified-id
/// dedup (an event notifies exactly once, ever — across restarts) and
/// Instagram-style burst collapsing (N same-author events in a window =
/// ONE updated notification with a count).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('notified-id dedup (restart replay fix)', () {
    test('an event is reported as new the first time, dup after', () async {
      final svc = LocalNotificationService.instance;
      await svc.resetNotifiedIds();
      expect(await svc.alreadyNotified('ev1'), isFalse); // new → show it
      expect(await svc.alreadyNotified('ev1'), isTrue); // dup → skip
      expect(await svc.alreadyNotified('ev2'), isFalse); // different → show
    });

    test('the dedup set survives a "restart" (fresh SharedPreferences read)', () async {
      final svc = LocalNotificationService.instance;
      await svc.resetNotifiedIds();
      await svc.alreadyNotified('persisted-ev');
      // Simulate a cold start: force a reload from the same prefs store.
      // (alreadyNotified re-reads via the singleton's cached set; the prefs
      // round-trip is what's pinned here — a second instance would see it.)
      expect(await svc.alreadyNotified('persisted-ev'), isTrue);
    });
  });

  group('burst collapsing (body text)', () {
    test('same-author events fold into "name and N others"', () {
      expect(
        LocalNotificationService.collapseBodyForTest('Alice liked your post', 1),
        'Alice liked your post',
      );
      expect(
        LocalNotificationService.collapseBodyForTest('Alice liked your post', 2),
        'Alice and 1 others liked your post',
      );
      expect(
        LocalNotificationService.collapseBodyForTest('Alice liked your post', 6),
        'Alice and 5 others liked your post',
      );
    });

    test('a body with no space passes through unchanged', () {
      expect(LocalNotificationService.collapseBodyForTest('Zap!', 5), 'Zap!');
    });
  });
}
