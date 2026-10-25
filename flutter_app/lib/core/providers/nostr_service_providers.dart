import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/moderation/flood_detector.dart';
import 'package:nostrfeed_mobile/core/nostr/event_bus.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';

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

/// ADR-0005 L2: the single event bus all relay traffic flows through.
/// Features acquire subscription specs on it (deduped, ref-counted) and
/// filter the union stream locally — instead of each opening raw relay
/// subscriptions. keepAlive: the bus is app-lifetime.
final eventBusProvider = Provider<EventBus>((ref) {
  final nostr = ref.watch(nostrServiceProvider);
  final bus = EventBus(subscribe: nostr.relayPool.subscribe);

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
