import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Quick test: connect to a relay and fetch some kind-1 events.
void main() async {
  final relays = [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://nostr.mom',
  ];

  for (final url in relays) {
    print('Testing $url ...');
    try {
      final ws = await WebSocket.connect(url).timeout(const Duration(seconds: 5));
      print('  ✅ Connected!');

      final completer = Completer<void>();
      var eventCount = 0;

      ws.listen(
        (raw) {
          try {
            final data = jsonDecode(raw as String) as List;
            if (data[0] == 'EVENT') {
              eventCount++;
              if (eventCount <= 2) {
                final event = data[2];
                print('  📦 Event kind=${event['kind']} id=${(event['id'] as String).substring(0, 8)}...');
                final content = event['content'] as String;
                print('     content: ${content.length > 80 ? '${content.substring(0, 80)}...' : content}');
              }
            } else if (data[0] == 'EOSE') {
              print('  ✅ EOSE received. Total events: $eventCount');
              completer.complete();
            }
          } catch (_) {}
        },
        onError: (e) {
          print('  ❌ Error: $e');
          if (!completer.isCompleted) completer.complete();
        },
        onDone: () {
          if (!completer.isCompleted) completer.complete();
        },
      );

      // Send a REQ for latest kind-1 events
      final req = jsonEncode(['REQ', 'test1', {'kinds': [1], 'limit': 5}]);
      ws.add(req);
      print('  → Sent REQ for kind:1, limit:5');

      await completer.future.timeout(const Duration(seconds: 10), onTimeout: () {
        print('  ⏰ Timeout after 10s. Events so far: $eventCount');
      });

      await ws.close();
    } catch (e) {
      print('  ❌ Failed to connect: $e');
    }
    print('');
  }

  print('Done.');
  exit(0);
}
