import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/features/settings/application/app_update_service.dart';

/// The available update, or null when the app is current / offline / the
/// version was dismissed. Checked lazily on first watch (drawer/banner).
/// Non-blocking by design — this NEVER gates app usage.
final appUpdateProvider = FutureProvider<AppRelease?>((ref) {
  return AppUpdateService.checkForUpdate();
});

/// Refresh the check (e.g. on app resume). Cheap + failure-tolerant.
Future<void> refreshUpdateCheck(WidgetRef ref) async {
  ref.invalidate(appUpdateProvider);
}
