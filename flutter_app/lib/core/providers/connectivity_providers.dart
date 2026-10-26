import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/feed/application/feed_notifier.dart';

/// Whether the device currently has any network route (wifi/cellular/
/// ethernet). `connectivity_plus` reports connection TYPE, not actual
/// internet reachability — but for a relay app the type is the useful
/// signal: no route = definitely offline.
final connectivityProvider = StreamProvider<List<ConnectivityResult>>((ref) {
  return Connectivity().onConnectivityChanged;
});

/// Whether the result list means "no usable network". Only an explicit
/// `ConnectivityResult.none` counts as offline. An EMPTY list is a
/// transient/unknown state (radio hand-off, VPN churn, emulator quirks) —
/// NOT proof of being offline (treating empty as offline is the
/// "banner shows even when connected" bug). When in doubt, assume online:
/// a failed relay fetch is a separate signal handled by the feed's own
/// error state, not the connectivity type.
bool _isOfflineResults(List<ConnectivityResult>? results) {
  if (results == null || results.isEmpty) return false;
  return results.every((r) => r == ConnectivityResult.none);
}

/// Simple offline flag for the UI. Starts false (assume online) and flips
/// as the stream reports.
final isOfflineProvider = Provider<bool>((ref) {
  final results = ref.watch(connectivityProvider).valueOrNull;
  if (results == null) return false;
  return _isOfflineResults(results);
});

/// Reconnect relays when the network comes back. Watched once at the app
/// root: on offline → online transitions, dead relay sockets are kicked
/// back to life (they re-issue their subscriptions via `_resubscribeAll`),
/// the in-memory image cache's parked failures are evicted so they retry,
/// and both feeds refresh their newest page silently (a merge, not a
/// skeleton).
final connectivityWatcherProvider = Provider<void>((ref) {
  // Track the last KNOWN offline state across the listener so a null/empty
  // `previous` (app start, or Android's empty-list transition) doesn't
  // swallow the first real offline→online recovery.
  var lastOffline = false;
  // Android drops to an EMPTY connectivity list during radio hand-off / VPN
  // churn (wifi → [] → cellular). Empty isn't "offline" for the banner, but
  // the relay sockets DID die in the gap — so losing a route we actually had
  // and getting one back needs the SAME recovery as offline→online. Without
  // this the feed's live tail stayed dead after every Android network blip
  // until a manual pull (the "feed stuck on Android, fine on iOS" bug —
  // iOS doesn't kill sockets this way and never emits an empty list).
  var hadRoute = false;
  var routeWasLost = false;
  ref.listen<AsyncValue<List<ConnectivityResult>>>(
    connectivityProvider,
    (previous, next) {
      final results = next.valueOrNull;
      if (results == null) return; // stream hasn't produced yet
      final nowOffline = _isOfflineResults(results);
      final hasRoute = results.isNotEmpty && !nowOffline;

      if (!hasRoute) {
        // Only a route we actually HAD counts as a loss — an app started
        // with no network must not fire a redundant recovery on first route.
        if (hadRoute) routeWasLost = true;
        lastOffline = nowOffline;
        return;
      }

      final recovered = lastOffline || routeWasLost;
      hadRoute = true;
      routeWasLost = false;
      lastOffline = false;

      if (recovered) {
        // Back online: reconnect dead relays immediately (not after their
        // backoff) so the feed/notifications resume at once.
        final nostr = ref.read(nostrServiceProvider);
        if (nostr.isInitialized) {
          nostr.relayPool.reconnectDead();
        }

        // Images that failed to resolve while offline are parked in the
        // painting image cache as failed loads and never retry on their
        // own — clearing the LIVE (pending/error) entries forces a refetch
        // now that a route exists, without re-downloading bitmaps that are
        // already decoded. Without this an offline session leaves "Image
        // unavailable" tiles stuck on screen until restart (the "images
        // don't show" bug).
        try {
          PaintingBinding.instance.imageCache.clearLiveImages();
        } catch (_) {}

        // The live feed subscriptions' sockets died while offline —
        // restarting re-issues them on the reconnected relays. Then refresh
        // both feeds silently (the current events stay on screen, this
        // merges the newest page in). Without it the feed stayed stale
        // after a network drop until a manual pull-to-refresh (the
        // "internet came back but nothing updated" bug).
        ref.read(globalFeedProvider.notifier)
          ..restartLive()
          ..refresh();
        ref.read(followingFeedNotifierProvider.notifier)
          ..restartLive()
          ..refresh();
      }
    },
  );
});
