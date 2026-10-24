import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lndhub_service.dart';

void main() {
  group('LndHubCredentials.parse', () {
    test('parses a full lndhub:// URI', () {
      final c = LndHubCredentials.parse(
        'lndhub://mylogin:secretpass@https://hub.example:3000',
      );
      expect(c, isNotNull);
      expect(c!.login, 'mylogin');
      expect(c.password, 'secretpass');
      expect(c.host, 'https://hub.example:3000');
    });

    test('adds https:// when the host has no scheme', () {
      final c = LndHubCredentials.parse(
        'lndhub://user:pass@hub.example:3000',
      );
      expect(c!.host, 'https://hub.example:3000');
    });

    test('URL-decodes login and password', () {
      final c = LndHubCredentials.parse(
        'lndhub://user%40mail.com:p%40ss%2Fword@hub.example',
      );
      expect(c!.login, 'user@mail.com');
      expect(c.password, 'p@ss/word');
    });

    test('strips trailing slashes from the host', () {
      final c = LndHubCredentials.parse(
        'lndhub://user:pass@https://hub.example/',
      );
      expect(c!.host, 'https://hub.example');
    });

    test('rejects non-lndhub strings', () {
      expect(LndHubCredentials.parse('nostr+walletconnect://abc'), isNull);
      expect(LndHubCredentials.parse('lnbc210n1example'), isNull);
      expect(LndHubCredentials.parse(''), isNull);
      expect(LndHubCredentials.parse('not-a-credential'), isNull);
    });

    test('rejects a URI missing the password', () {
      expect(LndHubCredentials.parse('lndhub://user@hub.example'), isNull);
    });

    test('round-trips back to URI form', () {
      const uri = 'lndhub://user:pass@https://hub.example:3000';
      final c = LndHubCredentials.parse(uri)!;
      expect(c.toUri(), uri);
    });
  });

  group('LndHubTx.fromJson', () {
    test('reads an outgoing payment', () {
      final tx = LndHubTx.fromJson({
        'type': 'paid_invoice',
        'amt': -2100,
        'memo': 'coffee',
        'timestamp': 1700000000,
      });
      expect(tx.amountSats, 2100);
      expect(tx.isIncoming, isFalse);
      expect(tx.memo, 'coffee');
    });

    test('reads an incoming invoice', () {
      final tx = LndHubTx.fromJson({
        'type': 'user_invoice',
        'amt': 5000,
        'ispaid': true,
      });
      expect(tx.amountSats, 5000);
      expect(tx.isIncoming, isTrue);
    });
  });
}
