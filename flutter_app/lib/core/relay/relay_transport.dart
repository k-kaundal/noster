import 'dart:async';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/relay/relay_core.dart';

/// ADR-0007 — the merged local+remote subscribe used by the EventBus.
///
/// One REQ fans out to BOTH transports and merges their event streams
/// (deduped by id):
///
/// - **Local relay** (ADR-0007): the stored tail is served instantly from
///   SQLite (offline-correct) and live events land with zero network. This
///   is what makes a cold feed render from cache and new posts appear
///   without a relay round-trip.
/// - **Remote pool** (unchanged): the network tail — everything we don't
///   hold yet.
///
/// The merged stream feeds the bus's existing cross-spec dedup + flood
/// gates, and the ingest pipeline stores + mirrors each event back into the
/// local relay — so the store stays the single source of truth and the
/// local relay's view of it stays current.
///
/// Rollback: when [enabled] is false, [subscribe] is a pass-through to the
/// remote pool — zero behavior change (the flag).
class MergedRelayTransport {
  MergedRelayTransport({
    required this.localRelay,
    required this.remoteSubscribe,
    this.enabled = true,
  });

  final LocalRelay? localRelay;

  /// The remote pool's subscribe (RelayPool.subscribe).
  final Stream<NostrEvent> Function(List<NostrFilter> filters) remoteSubscribe;

  /// Feature flag — false = remote-only (pre-ADR-0007 behavior).
  bool enabled;

  /// The EventBus subscribe signature: filters in, merged event stream out.
  Stream<NostrEvent> subscribe(List<NostrFilter> filters) {
    final local = localRelay;
    if (!enabled || local == null) return remoteSubscribe(filters);

    final controller = StreamController<NostrEvent>.broadcast();
    final seen = <String>{};
    final subs = <StreamSubscription<NostrEvent>>[];

    void emit(NostrEvent e) {
      if (controller.isClosed) return;
      if (!seen.add(e.id)) return;
      controller.add(e);
    }

    // Remote network events (live + their stored tail).
    subs.add(remoteSubscribe(filters).listen(
      emit,
      onError: (_) {}, // a dead relay never kills the merged stream
    ));

    // Local live events (the store's mirror) — immediately, no network.
    // (The stored tail is served by the local relay's own REQ path; here we
    // tap the live monitor so events ingested from ANY path fan out.)
    subs.add(local.liveEventsFor(filters).listen(
      emit,
      onError: (_) {},
    ));

    controller.onCancel = () {
      for (final s in subs) {
        unawaited(s.cancel());
      }
    };
    return controller.stream;
  }
}
