import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/settings/application/app_update_service.dart';

void main() {
  group('AppUpdateService.isNewer (semantic version compare)', () {
    test('higher minor version is newer', () {
      expect(AppUpdateService.isNewer('1.2.0', 7, '1.1.1', 6), isTrue);
    });

    test('same version, higher build is newer', () {
      expect(AppUpdateService.isNewer('1.2.0', 8, '1.2.0', 7), isTrue);
    });

    test('same version + build is NOT newer', () {
      expect(AppUpdateService.isNewer('1.2.0', 7, '1.2.0', 7), isFalse);
    });

    test('lower version is NOT newer', () {
      expect(AppUpdateService.isNewer('1.1.9', 9, '1.2.0', 7), isFalse);
    });

    test('higher major version is newer', () {
      expect(AppUpdateService.isNewer('2.0.0', 1, '1.9.9', 99), isTrue);
    });

    test('patch difference is detected', () {
      expect(AppUpdateService.isNewer('1.2.1', 8, '1.2.0', 7), isTrue);
    });

    test('two-part version compares against three-part', () {
      expect(AppUpdateService.isNewer('1.2', 7, '1.1.9', 6), isTrue);
    });
  });

  group('AppRelease.fromJson (manifest parsing)', () {
    test('parses a full manifest', () {
      final r = AppRelease.fromJson({
        'version': '1.2.0',
        'buildNumber': 7,
        'notes': 'Bug fixes',
        'playStoreUrl': 'https://play.google.com/x',
        'appStoreUrl': 'https://apps.apple.com/app/id1',
      });
      expect(r.version, '1.2.0');
      expect(r.buildNumber, 7);
      expect(r.notes, 'Bug fixes');
      expect(r.playStoreUrl, contains('play.google.com'));
      expect(r.appStoreUrl, contains('apps.apple.com'));
    });

    test('tolerates a minimal manifest', () {
      final r = AppRelease.fromJson({'version': '1.2.0'});
      expect(r.version, '1.2.0');
      expect(r.buildNumber, 0);
      expect(r.notes, isNull);
    });
  });
}
