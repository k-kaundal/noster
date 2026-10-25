import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/moderation/flood_detector.dart';
import 'package:nostrfeed_mobile/core/nostr/event_bus.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/core/relay/relay_core.dart';
import 'package:nostrfeed_mobile/core/relay/relay_transport.dart';

export 'package:nostrfeed_mobile/core/nostr/event_bus.dart'
    show EventBus, EventBusHandle, NostrFilterSetMatcher, NostrFilterMatcher;
export 'package:nostrfeed_mobile/core/nostr/nostr_service.dart'
    show NostrService;
export 'package:nostrfeed_mobile/core/nostr/repositories/engagement_repository.dart'
    show EventEngagement;
export 'package:nostrfeed_mobile/core/nostr/repositories/feed_repository.dart'
    show HashtagStat;

/// Nostr service singleton.
final nostrServiceProvider = Provider<NostrService>((ref) => NostrService());

/// ADR-0007: the in-app local relay — app-lifetime, backed by the EventStore
/// (the single source of truth). The ingest pipeline mirrors every stored
/// event into it (`onEvent`) so its live monitor stays current.
final localRelayProvider = Provider<LocalRelay>((ref) {
  final relay = LocalRelay(store: EventStore.instance);
  ref.onDispose(relay.dispose);
  return relay;
});

/// ADR-0007 feature flag: when false the merged transport is a pass-through
/// to the remote relay pool (pre-ADR-0007 behavior) — instant rollback.
final localRelayEnabledProvider = Provider<bool>((ref) => true);

/// ADR-0007: the merged local+remote subscribe the EventBus uses. Local
/// relay serves the stored tail instantly + live events with zero network;
/// the remote pool supplies the network tail. The remote pool remains the
/// transport for publishes and outbox routing.
final relayTransportProvider = Provider<MergedRelayTransport>((ref) {
  final nostr = ref.watch(nostrServiceProvider);
  final enabled = ref.watch(localRelayEnabledProvider);
  final relay = enabled ? ref.watch(localRelayProvider) : null;
  return MergedRelayTransport(
    localRelay: relay,
    remoteSubscribe: nostr.relayPool.subscribe,
    enabled: enabled,
  );
});

/// ADR-0005 L2: the single event bus all relay traffic flows through.
/// Features acquire subscription specs on it (deduped, ref-counted) and
/// filter the union stream locally — instead of each opening raw relay
/// subscriptions. keepAlive: the bus is app-lifetime.
final eventBusProvider = Provider<EventBus>((ref) {
  final transport = ref.watch(relayTransportProvider);
  final bus = EventBus(subscribe: transport.subscribe);

  // L3 flood gate (ADR-0005): feed-post floods/sprays/rapid-fire bursts are
  // dropped HERE — once, for every consumer — instead of each feature
  // re-judging. Only standalone kind-1 posts are judged (a reply is thread
  // content, never flood-dropped); all other kinds pass through.
  final detector = ref.watch(floodDetectorProvider);
  bus.addGate((event) {
    if (event.kind != 1 || event.isReply) return true;
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    detector.observe(event, nowSeconds: now);
    return detector.verdictFor(event, nowSeconds: now) == FloodVerdict.clean;
  });

  return bus;
});

/// Helper: ensure service is initialized before querying.
Future<NostrService> initNostr(Ref ref) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr;
}
