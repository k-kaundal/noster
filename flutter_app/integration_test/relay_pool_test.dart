import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

void main() {
  test('RelayPool connects and queries', () async {
    final pool = RelayPool(relays: [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
      'wss://nostr.mom',
    ]);

    await pool.connectAll();
    print('Connected: ${pool.connectedCount} relays');
    print('URLs: ${pool.connectedUrls}');
    expect(pool.connectedCount, greaterThan(0));

    print('Querying feed...');
    final events = await pool.query(
      [NostrFilter(kinds: [1], limit: 10)],
      timeout: const Duration(seconds: 10),
    );
    print('Got ${events.length} events');
    expect(events, isNotEmpty);

    for (final e in events.take(3)) {
      print('  ${e.pubkey.substring(0, 8)}: ${e.content.substring(0, e.content.length > 60 ? 60 : e.content.length)}');
    }

    pool.disconnectAll();
  }, timeout: const Timeout(Duration(seconds: 30)));

  test('RelayPool can query profiles', () async {
    final pool = RelayPool(relays: [
      'wss://relay.damus.io',
      'wss://nos.lol',
    ]);

    await pool.connectAll();
    expect(pool.connectedCount, greaterThan(0));

    // Jack Dorsey's pubkey
    final events = await pool.query(
      [NostrFilter(kinds: [0], authors: ['82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2'], limit: 1)],
      timeout: const Duration(seconds: 10),
    );

    print('Got ${events.length} profile events');
    if (events.isNotEmpty) {
      print('Profile content: ${events.first.content}');
    }

    pool.disconnectAll();
  }, timeout: const Timeout(Duration(seconds: 30)));
}
