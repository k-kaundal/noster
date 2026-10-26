import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';
import 'package:nostrfeed_mobile/features/premium/data/admission_service.dart';

/// Delivery routing for encrypted DMs (NIP-17 gift wraps).
///
/// Problem this solves: publishing a gift wrap only to *our* relays doesn't
/// guarantee the recipient's client sees it — e.g. a Primal user primarily
/// watches `wss://relay.primal.net`. NIP-17's answer is the recipient's
/// kind-10050 "DM inbox relay list": senders publish the wrap to the
/// relays the RECIPIENT says they read.
///
/// Tier-aware strategy (in order):
/// 1. **Paid ↔ Paid** — BOTH parties are admitted to `paid.nostrfeed.com`:
///    deliver to the PAID relay. Premium DMs never touch the free hub —
///    faster (a relay we operate, not the public slice) and the metadata
///    never leaves our paid infra. This is a premium-only benefit.
/// 2. **Recipient's kind-10050 inbox relays** (if found) — external users,
///    or mixed paid/free pairs: honor the recipient's declared inbox.
/// 3. **Well-known DM relays** — big public relays that most clients
///    (Primal, Damus, Amethyst, 0xchat) watch for DMs.
class DmDelivery {
  final RelayPool relayPool;
  final AdmissionService _admission;
  DmDelivery(this.relayPool, [AdmissionService? admission])
      : _admission = admission ?? const AdmissionService();

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

  /// Cache of pubkey → paid-admission, so routing a DM costs no extra
  /// request after the first (admission is sticky — bought once per key).
  final Map<String, bool> _admittedCache = {};

  /// Whether [pubkey] is admitted to the paid relay. Cached; a failed check
  /// counts as NOT admitted (routing falls through to the free path — the
  /// message still delivers, just not via the premium lane).
  Future<bool> _isAdmitted(String pubkey) async {
    final cached = _admittedCache[pubkey];
    if (cached != null) return cached;
    var admitted = false;
    try {
      admitted = await _admission.check(pubkey) == AdmissionState.admitted;
    } catch (_) {
      admitted = false;
    }
    _admittedCache[pubkey] = admitted;
    return admitted;
  }

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

  /// The relays to deliver a DM from [senderPubkey] to [peerPubkey].
  ///
  /// When their inbox IS known, we trust it and add only OUR primary relay
  /// (so our own client sees the message on its home relay) — not the full
  /// fallback set. The old union-with-everything sprayed every DM to 8+
  /// relays; NIP-17 explicitly says keep delivery targeted (1–3 relays).
  Future<List<String>> deliveryRelaysFor(
    String peerPubkey, {
    String? senderPubkey,
  }) async {
    // 1. Paid ↔ Paid premium lane: BOTH admitted → the paid relay. Checked
    //    first so premium DMs never spray to public relays unnecessarily.
    if (senderPubkey != null &&
        await _isAdmitted(senderPubkey) &&
        await _isAdmitted(peerPubkey)) {
      return [Env.paidRelay];
    }

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

  /// Invalidate cached routing (e.g. user says "retry delivery" or a key
  /// just bought admission — the next DM should discover the premium lane).
  void invalidate(String peerPubkey) {
    _inboxCache.remove(peerPubkey);
    _admittedCache.remove(peerPubkey);
  }
}
