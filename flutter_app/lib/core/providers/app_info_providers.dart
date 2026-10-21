import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// The app's own version info, read from the platform bundle (which the
/// build fills from pubspec's `version:` line).
///
/// The drawer's version string used to be a hardcoded 'v1.0.0' — it lied
/// the first release after it was written. This reads the real one:
/// `versionName` is the pubspec version (1.0.1), `buildNumber` is the
/// build (+3).
final packageInfoProvider = FutureProvider<PackageInfo>((ref) {
  return PackageInfo.fromPlatform();
});

/// The display version: `1.0.1 (3)`.
final appVersionProvider = Provider<String>((ref) {
  final info = ref.watch(packageInfoProvider).valueOrNull;
  if (info == null) return '';
  return '${info.version} (${info.buildNumber})';
});
