
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

/// Whether the device currently has any network route (wifi/cellular/
/// ethernet). `connectivity_plus` reports connection TYPE, not actual
/// internet reachability — but for a relay app the type is the useful
/// signal: no route = definitely offline.
final connectivityProvider = StreamProvider<List<ConnectivityResult>>((ref) {
  return Connectivity().onConnectivityChanged;
});

/// Simple offline flag for the UI. Starts false (assume online) and flips
/// as the stream reports.
final isOfflineProvider = Provider<bool>((ref) {
  final results = ref.watch(connectivityProvider).valueOrNull;
  if (results == null) return false;
  return results.every((r) => r == ConnectivityResult.none);
});

/// Reconnect relays when the network comes back. Watched once at the app
/// root: on offline → online transitions, dead relay sockets are kicked
/// back to life (they re-issue their subscriptions via `_resubscribeAll`),
/// and feeds refresh their newest page.
final connectivityWatcherProvider = Provider<void>((ref) {
  ref.listen<AsyncValue<List<ConnectivityResult>>>(
    connectivityProvider,
    (previous, next) {
      final wasOffline = previous?.valueOrNull?.every(
            (r) => r == ConnectivityResult.none,
          ) ??
          false;
      final nowOffline = next.valueOrNull?.every(
            (r) => r == ConnectivityResult.none,
          ) ??
          false;

      if (wasOffline && !nowOffline) {
        // Back online: reconnect dead relays immediately (not after their
        // backoff) so the feed/notifications resume at once.
        final nostr = ref.read(nostrServiceProvider);
        if (nostr.isInitialized) {
          nostr.relayPool.reconnectDead();
        }
      }
    },
  );
});
