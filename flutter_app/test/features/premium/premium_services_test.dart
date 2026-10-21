import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/premium/services/bunker_service.dart';
import 'package:nostrfeed_mobile/features/premium/services/nwc_provider_service.dart';

void main() {
  group('BunkerConnection.fromJson', () {
    test('parses a connection URL with permissions + relays', () {
      final conn = BunkerConnection.fromJson({
        'id': 'abc',
        'name': 'App link',
        'relays': ['wss://relay1', 'wss://relay2'],
        'permissions': ['sign_event', 'get_public_key'],
        'bunker_url': 'bunker://xyz?relay=wss://relay1',
        'client_pubkey': 'deadbeef',
      });
      expect(conn.id, 'abc');
      expect(conn.name, 'App link');
      expect(conn.relays, ['wss://relay1', 'wss://relay2']);
      expect(conn.permissions, ['sign_event', 'get_public_key']);
      expect(conn.bunkerUrl, 'bunker://xyz?relay=wss://relay1');
      expect(conn.clientPubkey, 'deadbeef');
    });

    test('tolerates missing fields', () {
      final conn = BunkerConnection.fromJson({'id': 'x'});
      expect(conn.id, 'x');
      expect(conn.relays, isEmpty);
      expect(conn.permissions, isEmpty);
      expect(conn.bunkerUrl, isNull);
    });

    test('sanitizes the name (UTF-16 crash guard)', () {
      final conn = BunkerConnection.fromJson({
        'id': 'x',
        'name': 'my \uD83Dkey',
      });
      // The lone surrogate is dropped, not kept.
      expect(conn.name, 'my key');
    });
  });

  group('BunkerKey.fromJson', () {
    test('parses a stored key', () {
      final key = BunkerKey.fromJson({'id': 'k1', 'name': 'My key'});
      expect(key.id, 'k1');
      expect(key.name, 'My key');
    });

    test('defaults the name', () {
      final key = BunkerKey.fromJson({'id': 'k1'});
      expect(key.name, 'Key');
    });
  });

  group('NwcProviderConnection.fromJson', () {
    test('parses a connection (nested data shape)', () {
      final conn = NwcProviderConnection.fromJson({
        'data': {
          'pubkey': 'pk123',
          'wallet': 'wallet1',
          'description': 'From NostrFeed',
          'expires_at': 1735689600,
          'permissions': ['pay_invoice', 'get_balance'],
          'last_used': 1735600000,
        },
      });
      expect(conn.pubkey, 'pk123');
      expect(conn.wallet, 'wallet1');
      expect(conn.description, 'From NostrFeed');
      expect(conn.expiresAt, 1735689600);
      expect(conn.permissions, ['pay_invoice', 'get_balance']);
      expect(conn.lastUsed, 1735600000);
    });

    test('parses a flat shape too', () {
      final conn = NwcProviderConnection.fromJson({
        'pubkey': 'pk',
        'wallet': 'w',
      });
      expect(conn.pubkey, 'pk');
      expect(conn.wallet, 'w');
      expect(conn.permissions, isEmpty);
    });
  });
}
