import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/wallet/services/lnbits_service.dart';

void main() {
  group('active LNbits url (settings override)', () {
    tearDown(() => setActiveLnbitsUrl(defaultLnbitsUrl));

    test('a no-arg service uses the compile-time default by default', () {
      setActiveLnbitsUrl(defaultLnbitsUrl);
      expect(LnbitsService().baseUrl, defaultLnbitsUrl);
    });

    test('setActiveLnbitsUrl re-points every no-arg service', () {
      setActiveLnbitsUrl('https://wallet.example.com/');
      expect(lnbitsUrl, 'https://wallet.example.com');
      expect(LnbitsService().baseUrl, 'https://wallet.example.com');
    });

    test('trailing slashes are stripped', () {
      setActiveLnbitsUrl('https://wallet.example.com///');
      expect(lnbitsUrl, 'https://wallet.example.com');
    });

    test('empty input is refused, keeps the current value', () {
      setActiveLnbitsUrl('https://wallet.example.com');
      setActiveLnbitsUrl('   ');
      expect(lnbitsUrl, 'https://wallet.example.com');
    });

    test('an explicit baseUrl still wins (never overridden)', () {
      setActiveLnbitsUrl('https://wallet.example.com');
      expect(LnbitsService(baseUrl: 'https://other.example.com').baseUrl,
          'https://other.example.com');
    });
  });
}
