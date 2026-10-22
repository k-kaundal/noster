import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';

/// Delivery routing for encrypted DMs (NIP-17 gift wraps).
///
/// Problem this solves: publishing a gift wrap only to *our* relays doesn't
/// guarantee the recipient's client sees it — e.g. a Primal user primarily
/// watches `wss://relay.primal.net`. NIP-17's answer is the recipient's
/// kind-10050 "DM inbox relay list": senders publish the wrap to the
/// relays the RECIPIENT says they read.
///
/// Strategy (in order):
/// 1. Recipient's kind-10050 inbox relays (if found)
/// 2. Well-known DM relays — big public relays that most clients
///    (Primal, Damus, Amethyst, 0xchat) watch for DMs.
class DmDelivery {
  final RelayPool relayPool;
  DmDelivery(this.relayPool);

  /// Well-known relays that major Nostr clients watch for DMs. Used as
  /// fallback when the recipient hasn't published a kind-10050 list.
  /// Trimmed to the 3 highest-coverage ones (Primal + Damus + our own) —
  /// the old 5-relay union sprayed every DM to 8+ relays, which leaked
  /// metadata and slowed sends for near-zero delivery gain.
  static const fallbackDmRelays = [
    'wss://relay.primal.net',
    'wss://relay.damus.io',
    'wss://relay.nostrfeed.com',
  ];

  /// Cache of peer → inbox relays, so we only look them up once per session.
  final Map<String, List<String>> _inboxCache = {};

  /// Fetch the recipient's NIP-17 DM inbox relays (kind 10050).
  /// Returns an empty list when the user hasn't published one.
  Future<List<String>> fetchDmInboxRelays(String peerPubkey) async {
    if (_inboxCache.containsKey(peerPubkey)) return _inboxCache[peerPubkey]!;
    var relays = <String>[];
    try {
      final events = await relayPool.query(
        [NostrFilter(kinds: [10050], authors: [peerPubkey], limit: 1)],
        timeout: const Duration(seconds: 4),
      );
      if (events.isNotEmpty) {
        relays = events.first
            .getTags('relay')
            .where((u) => u.startsWith('wss://') || u.startsWith('ws://'))
            .toList();
      }
    } catch (_) {
      // Lookup is best-effort — fall back to well-known relays.
    }
    _inboxCache[peerPubkey] = relays;
    return relays;
  }

  /// The relays to deliver a DM to [peerPubkey]: their inbox list if they
  /// have one (1–3 relays per NIP-17), otherwise a SMALL fallback set.
  ///
  /// When their inbox IS known, we trust it and add only OUR primary relay
  /// (so our own client sees the message on its home relay) — not the full
  /// fallback set. The old union-with-everything sprayed every DM to 8+
  /// relays; NIP-17 explicitly says keep delivery targeted (1–3 relays).
  Future<List<String>> deliveryRelaysFor(String peerPubkey) async {
    final inbox = await fetchDmInboxRelays(peerPubkey);
    if (inbox.isNotEmpty) {
      return {
        ...inbox.take(3),
        'wss://relay.nostrfeed.com', // our home relay, for self history
      }.toList();
    }
    return List.of(fallbackDmRelays);
  }

  /// Ensure the pool has connections to these relay URLs so we can publish
  /// to them (ad-hoc connections are created if needed).
  Future<void> ensureConnections(List<String> relayUrls) async {
    for (final url in relayUrls) {
      final normalized = normalizeRelayUrl(url);
      relayPool.ensureConnection(normalized);
    }
  }

  /// Invalidate the cached inbox list (e.g. user says "retry delivery").
  void invalidate(String peerPubkey) => _inboxCache.remove(peerPubkey);
}
