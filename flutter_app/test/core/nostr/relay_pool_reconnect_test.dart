import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';

void main() {
  group('RelayPool reconnection resilience', () {
    test('reconnectDead is safe with no connections', () async {
      final pool = RelayPool(relays: const []);
      // Must not throw.
      await pool.reconnectDead();
      expect(pool.connectedCount, 0);
    });

    test('pool starts with configured relays', () {
      final pool = RelayPool(relays: const [
        'wss://relay.example.com',
        'wss://relay2.example.com',
      ]);
      expect(pool.relayUrls, hasLength(2));
    });
  });
}
