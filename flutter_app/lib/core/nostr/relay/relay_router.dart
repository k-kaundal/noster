import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';

/// NIP-65 outbox model: routes fetches/publishes to the right relays per user.
///
/// The problem: Nostr is thousands of relays. Querying random/default relays
/// for a user's profile (kind 0), posts, or DM inbox is hit-or-miss — the
/// user may publish to entirely different relays. NIP-65 (kind 10002) lets
/// each user advertise where they WRITE (their outbox) and where they READ
/// mentions (their inbox). Professional clients route accordingly:
///
///  - To READ a user's events (profile, posts) → query their WRITE relays.
///  - To SEND a user something (DM, mention) → publish to their READ relays.
///
/// This service maintains a routing table (pubkey → relay hints), fetching
/// kind-10002 events lazily and caching them in-memory.
class RelayRouter {
  final RelayPool relayPool;
  RelayRouter(this.relayPool);

  /// pubkey → (write relays, read relays). Filled by [getWriteRelays] /
  /// [getReadRelays] on first use.
  final Map<String, ({List<String> write, List<String> read})> _cache = {};

  /// Well-known indexer relays where kind-10002 / kind-0 events are
  /// commonly aggregated — used to LOOK UP relay lists themselves.
  static const indexerRelays = [
    'wss://relay.nostrfeed.com',
    'wss://purplepag.es',
    'wss://relay.primal.net',
    'wss://indexer.coracle.social',
    'wss://directory.yabu.me',
  ];

  /// Parse a kind-10002 event into (write, read) relay URL lists.
  static ({List<String> write, List<String> read}) parseRelayList(
    NostrEvent event,
  ) {
    final write = <String>[];
    final read = <String>[];
    for (final tag in event.tags) {
      if (tag.length < 2 || tag[0] != 'r') continue;
      final url = tag[1];
      if (!url.startsWith('wss://') && !url.startsWith('ws://')) continue;
      final marker = tag.length >= 3 ? tag[2].toLowerCase() : '';
      if (marker == 'write') {
        write.add(url);
      } else if (marker == 'read') {
        read.add(url);
      } else {
        // No marker → both read and write (NIP-65).
        write.add(url);
        read.add(url);
      }
    }
    return (write: write, read: read);
  }

  /// Fetch + cache a user's kind-10002 relay list. Returns null when the
  /// user hasn't published one.
  Future<({List<String> write, List<String> read})?> _relayListFor(
    String pubkey,
  ) async {
    if (_cache.containsKey(pubkey)) return _cache[pubkey];
    try {
      final events = await relayPool.query([
        NostrFilter(kinds: [10002], authors: [pubkey], limit: 1),
      ], timeout: const Duration(seconds: 4));
      if (events.isEmpty) return null;
      // Take the newest replaceable revision.
      events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      final parsed = parseRelayList(events.first);
      _cache[pubkey] = parsed;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  /// Relays where [pubkey] WRITES events — query these to read their
  /// profile (kind 0), posts, etc. Falls back to [fallback] (or empty) when
  /// the user has no relay list.
  Future<List<String>> getWriteRelays(
    String pubkey, {
    List<String> fallback = const [],
  }) async {
    final list = await _relayListFor(pubkey);
    if (list == null || list.write.isEmpty) return List.of(fallback);
    return list.write;
  }

  /// Relays where [pubkey] READS mentions/DMs — publish to these so they
  /// see it. Falls back to [fallback] when the user has no relay list.
  Future<List<String>> getReadRelays(
    String pubkey, {
    List<String> fallback = const [],
  }) async {
    final list = await _relayListFor(pubkey);
    if (list == null || list.read.isEmpty) return List.of(fallback);
    return list.read;
  }

  /// Invalidate cached routing (e.g. user updated their relay list).
  void invalidate(String pubkey) => _cache.remove(pubkey);
}
