import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/wallet/services/nwc_service.dart';

void main() {
  group('NwcService.parseUri (NIP-47)', () {
    const validPubkey =
        'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4';
    const validSecret =
        '71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c';

    test('parses a standard connection URI', () {
      final uri = NwcService.parseUri(
        'nostr+walletconnect://$validPubkey?relay=wss%3A%2F%2Frelay.damus.io&secret=$validSecret',
      );
      expect(uri, isNotNull);
      expect(uri!.walletPubkey, validPubkey);
      expect(uri.secret, validSecret);
    });

    test('parses multiple relay params', () {
      final uri = NwcService.parseUri(
        'nostr+walletconnect://$validPubkey?relay=wss://r1.com&relay=wss://r2.com&secret=$validSecret',
      );
      expect(uri!.relays, hasLength(2));
      expect(uri.relays, containsAll(['wss://r1.com', 'wss://r2.com']));
    });

    test('handles nostrwalletconnect:// (no plus) variant', () {
      final uri = NwcService.parseUri(
        'nostrwalletconnect://$validPubkey?relay=wss://r.com&secret=$validSecret',
      );
      expect(uri, isNotNull);
      expect(uri!.walletPubkey, validPubkey);
    });

    test('extracts lud16 when present', () {
      final uri = NwcService.parseUri(
        'nostr+walletconnect://$validPubkey?relay=wss://r.com&secret=$validSecret&lud16=alice@wallet.com',
      );
      expect(uri!.lud16, 'alice@wallet.com');
    });

    test('rejects missing secret', () {
      final uri = NwcService.parseUri(
        'nostr+walletconnect://$validPubkey?relay=wss://r.com',
      );
      expect(uri, isNull);
    });

    test('rejects invalid pubkey', () {
      final uri = NwcService.parseUri(
        'nostr+walletconnect://nothex?relay=wss://r.com&secret=$validSecret',
      );
      expect(uri, isNull);
    });

    test('rejects no relay', () {
      final uri = NwcService.parseUri(
        'nostr+walletconnect://$validPubkey?secret=$validSecret',
      );
      expect(uri, isNull);
    });

    test('rejects non-NWC scheme', () {
      final uri = NwcService.parseUri('https://example.com');
      expect(uri, isNull);
    });
  });
}
