import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/sync/negentropy_sync.dart';
import 'package:nostrfeed_mobile/core/nostr/sync/negentropy_transport.dart';

/// ADR-0007 Phase 5 — the sync service: NIP-77 against the user's relays,
/// with graceful fallback.
///
/// One pass = for each relay: reconcile the feed scope (recent window of
/// feed-kind events), download what we're missing, upload what they lack.
/// Relays that don't speak NIP-77 (most, today) return `NEG-ERR` or
/// nothing → [NegentropySyncClient] yields null and that relay is skipped
/// (the classic windowed REQ in `syncNow` still covers it).
///
/// Bounded: the reconcile scope is capped (kinds + since) so a huge store
/// doesn't build a giant NEG-OPEN. The protocol itself is bandwidth-cheap —
/// the point is to make every reconnect + sync-window wake nearly free.
class NegentropySyncService {
  NegentropySyncService({EventStore? store})
      : _client = NegentropySyncClient(store: store ?? EventStore.instance);

  final NegentropySyncClient _client;

  /// The default sync scope: recent feed-kind events (last 24 h). Sync is
  /// for gap-filling the recent window, not for reconciling history.
  static NostrFilter feedScope({Duration window = const Duration(hours: 24)}) {
    final since =
        DateTime.now().subtract(window).millisecondsSinceEpoch ~/ 1000;
    return NostrFilter(
      kinds: const [1, 6, 16, 20, 21, 22, 30023, 1068],
      since: since,
    );
  }

  /// Reconcile [filter] against every relay in [relayUrls]. Returns the
  /// per-relay outcomes (null per unsupported/unreachable relay — never
  /// throws). Downloaded events land in the store by the client.
  ///
  /// ADR-0008 P6 — **bounded-parallel**: relays reconcile CONCURRENTLY (was
  /// sequential — each relay's up-to-40s worst case serialized, so a slow
  /// relay stalled the whole pass). One bad relay never kills the others;
  /// [parallelism] caps how many sockets open at once (a phone shouldn't
  /// hold 9 NEG sockets simultaneously).
  Future<List<NegentropySyncResult?>> syncAll(
    List<String> relayUrls,
    NostrFilter filter, {
    int parallelism = 4,
    bool uploadMissing = true,
  }) async {
    final outcomes = List<NegentropySyncResult?>.filled(relayUrls.length, null);
    var index = 0;
    // Bounded worker pool: at most [parallelism] reconciliations in flight.
    Future<void> worker() async {
      while (true) {
        final i = index++;
        if (i >= relayUrls.length) return;
        try {
          outcomes[i] = await _client.syncWithRelay(
            wsUrl: relayUrls[i],
            filter: filter,
            connect: (uri) => WsNegTransport.connect(uri),
            uploadMissing: uploadMissing,
          );
        } catch (_) {
          outcomes[i] = null; // one bad relay never kills the pass
        }
      }
    }

    await Future.wait([
      for (var w = 0; w < parallelism && w < relayUrls.length; w++) worker(),
    ]);
    return outcomes;
  }

  /// Convenience: sync the default feed scope against [relayUrls]. Returns
  /// the number of relays that successfully reconciled (spoke NIP-77).
  Future<int> syncFeedScope(List<String> relayUrls) async {
    final outcomes = await syncAll(relayUrls, feedScope());
    return outcomes.where((o) => o != null).length;
  }
}

final negentropySyncServiceProvider = Provider<NegentropySyncService>(
  (ref) => NegentropySyncService(),
);
