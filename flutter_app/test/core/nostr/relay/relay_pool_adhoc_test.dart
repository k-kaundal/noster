import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0008 P3: the ad-hoc (T3 outbox-discovery) connection pool is BOUNDED
/// with LRU eviction — ephemeral per-user relays must not accumulate one
/// socket per contact forever.
void main() {
  sqfliteFfiInit();

  setUp(() async {
    await EventStore.instance.debugReset();
  });

  tearDown(() {
    EventStore.debugOpenOverride = null;
    return EventStore.instance.debugReset();
  });

  test('ad-hoc pool evicts the least-recently-used connection past the cap', () {
    final pool = RelayPool(relays: const []);
    // Touch 6 distinct ad-hoc relays (cap is 4) — the oldest must be evicted.
    // ensureConnection creates the connection + touches the ad-hoc tracker.
    pool.ensureConnection('wss://a1.example');
    pool.ensureConnection('wss://a2.example');
    pool.ensureConnection('wss://a3.example');
    pool.ensureConnection('wss://a4.example');
    expect(pool.connections.length, 4); // at cap

    // A 5th + 6th push the two oldest (a1, a2) out via LRU.
    pool.ensureConnection('wss://a5.example');
    pool.ensureConnection('wss://a6.example');

    final urls = pool.connections.map((c) => c.url).toSet();
    expect(pool.connections.length, 4); // still bounded
    expect(urls, isNot(contains('wss://a1.example'))); // evicted (oldest)
    expect(urls, isNot(contains('wss://a2.example'))); // evicted
    expect(urls, containsAll([
      'wss://a3.example',
      'wss://a4.example',
      'wss://a5.example',
      'wss://a6.example',
    ]));
    pool.disconnectAll();
  });

  test('re-using an ad-hoc relay refreshes its LRU position (not evicted)', () {
    final pool = RelayPool(relays: const []);
    pool.ensureConnection('wss://a1.example');
    pool.ensureConnection('wss://a2.example');
    pool.ensureConnection('wss://a3.example');
    pool.ensureConnection('wss://a4.example');
    // Re-use a1 → it's now the most-recently-used, so a2 becomes the LRU.
    pool.ensureConnection('wss://a1.example');
    pool.ensureConnection('wss://a5.example'); // pushes the LRU (a2) out

    final urls = pool.connections.map((c) => c.url).toSet();
    expect(urls, contains('wss://a1.example')); // refreshed → survives
    expect(urls, isNot(contains('wss://a2.example'))); // evicted
    pool.disconnectAll();
  });

  test('platform/curated relays are NEVER evicted by the ad-hoc bound', () {
    final pool = RelayPool(relays: const []);
    // Add a platform relay as an actual connection (addRelay creates it),
    // then flood ad-hoc relays past the cap — the platform one must survive.
    pool.addRelay('wss://relay.nostrfeed.com');
    for (var i = 0; i < 8; i++) {
      pool.ensureConnection('wss://adhoc$i.example');
    }
    final urls = pool.connections.map((c) => c.url).toSet();
    expect(urls, contains('wss://relay.nostrfeed.com')); // platform survives
    // The ad-hoc pool stayed bounded (≤4 ad-hoc connections).
    final adhoc = urls.where((u) => u.contains('adhoc')).length;
    expect(adhoc, lessThanOrEqualTo(4));
    pool.disconnectAll();
  });
}
