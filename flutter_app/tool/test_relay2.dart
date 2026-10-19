import 'dart:async';
import 'dart:io';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';

void main() async {
  // Test RelayPool directly
  print('=== Testing RelayPool ===');
  final pool = RelayPool(relays: [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://nostr.mom',
  ]);

  print('Connecting...');
  await pool.connectAll();
  print('Connected to ${pool.connectedCount} relays: ${pool.connectedUrls}');
  print('Relay states: ${pool.relayStates}');

  if (pool.connectedCount > 0) {
    print('\nQuerying for kind:1 events (limit 10)...');
    final stopwatch = Stopwatch()..start();
    final events = await pool.query(
      [NostrFilter(kinds: [1], limit: 10)],
      timeout: const Duration(seconds: 10),
    );
    stopwatch.stop();
    print('Got ${events.length} events in ${stopwatch.elapsedMilliseconds}ms');
    for (final e in events.take(5)) {
      final c = e.content;
      print('  kind=${e.kind} | ${c.length > 60 ? '${c.substring(0, 60)}...' : c}');
    }
  } else {
    print('❌ No relays connected!');
    // Debug: try connecting one by one
    for (final url in ['wss://relay.damus.io', 'wss://nos.lol']) {
      print('\nTrying $url individually...');
      final conn = RelayConnection(url);
      try {
        await conn.connect().timeout(const Duration(seconds: 10));
        print('  State: ${conn.state}');
        if (conn.isConnected) {
          final sub = conn.subscribeWithEose([NostrFilter(kinds: [1], limit: 3)]);
          var count = 0;
          sub.stream.listen((e) {
            count++;
            print('  Event: ${e.id.substring(0, 8)}');
          });
          await Future.any([sub.eose, Future.delayed(const Duration(seconds: 8))]);
          print('  Got $count events');
          conn.unsubscribe(sub.id);
        }
      } catch (e) {
        print('  ❌ $e');
      }
      conn.disconnect();
    }
  }

  pool.disconnectAll();
  exit(0);
}
