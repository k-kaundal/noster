import 'dart:io';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';

void main() async {
  print('=== Testing NostrService.init() ===');
  final nostr = NostrService();

  print('Calling init()...');
  final sw = Stopwatch()..start();
  await nostr.init();
  sw.stop();
  print('init() completed in ${sw.elapsedMilliseconds}ms');
  print('Connected relays: ${nostr.relayPool.connectedCount}');
  print('Connected URLs: ${nostr.relayPool.connectedUrls}');

  print('\n=== Testing fetchFeed() ===');
  final sw2 = Stopwatch()..start();
  final events = await nostr.fetchFeed(limit: 20);
  sw2.stop();
  print('fetchFeed() returned ${events.length} events in ${sw2.elapsedMilliseconds}ms');
  for (final e in events.take(3)) {
    final c = e.content;
    print('  ${e.pubkey.substring(0, 8)}: ${c.length > 60 ? '${c.substring(0, 60)}...' : c}');
  }

  print('\n=== Testing fetchProfile() ===');
  if (events.isNotEmpty) {
    final profile = await nostr.fetchProfile(events.first.pubkey);
    print('Profile: ${profile?.displayNameOrName ?? "null"}');
  }

  nostr.relayPool.disconnectAll();
  exit(0);
}
