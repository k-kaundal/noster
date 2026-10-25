import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_gap_fill.dart';
import 'package:nostrfeed_mobile/features/feed/application/feed_notifier.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_live_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/wallet_sync_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// ADR-0005 P5 — the background catch-up, centralized.
///
/// What a "background sync" IS for a Nostr client (the research-backed
/// answer — Damus/Gossip/Amethyst all converge on it): persistent mobile
/// sockets are unreliable (iOS kills them; Android Doze throttles them) and
/// battery-expensive on cellular (~several %/hour measured by ntfy). The
/// right pattern is **periodic catch-up**: briefly reconnect, fetch exactly
/// what arrived during the gap, notify, disconnect.
///
/// This service is that catch-up, extracted from `app.dart`'s resume path
/// into ONE testable unit with TWO callers:
///
/// 1. **App resume** (`didChangeAppLifecycleState`) — wired today.
/// 2. **A periodic scheduler** (WorkManager / BGTaskScheduler) — the seam
///    is [registerPeriodicSync]/[unregisterPeriodicSync]. The workmanager
///    package isn't available offline right now (pub.dev unreachable), so
///    the actual OS-task registration lands the moment the package can be
///    fetched — the callback body is EXACTLY [syncNow] on a fresh
///    [ProviderContainer]; nothing else changes. See ADR-0005 P5 notes.
///
/// Battery honesty: this is the cheap tier (no persistent socket, no
/// foreground service). The opt-in "instant notifications" tier (Android
/// foreground service, DM/inbox relays only — Amethyst's model) is P5b.
class BackgroundSyncService {
  BackgroundSyncService(this._ref);

  final Ref _ref;

  static const _enabledKey = 'settings:background_sync_enabled';

  /// Master switch for the periodic catch-up (default ON — it's the
  /// battery-cheap tier; the persistent-socket tier is the opt-in one).
  Future<bool> isEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_enabledKey) ?? true;
  }

  Future<void> setEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_enabledKey, enabled);
    if (enabled) {
      await registerPeriodicSync();
    } else {
      await unregisterPeriodicSync();
    }
  }

  /// One catch-up pass. Safe to call from any engine/process: reconnects
  /// dead relays, restarts the live tails, refreshes both feeds, resyncs
  /// wallets, and gap-fills DMs (which fires local notifications for what
  /// arrived while we were gone). Every step is individually failure-safe —
  /// a dead relay or offline radio never throws out of the pass.
  Future<void> syncNow() async {
    if (_ref.read(authStateProvider).pubkey == null) return;
    final nostr = _ref.read(nostrServiceProvider);
    if (!nostr.isInitialized) await nostr.init();

    // Relays die on OS idle — reconnect (re-issues live subscriptions).
    nostr.relayPool.reconnectDead();

    // Feeds: restart live tails + silent refresh (store-first, no skeleton).
    final global = _ref.read(globalFeedProvider.notifier);
    global.restartLive();
    unawaited(global.refresh());
    final following = _ref.read(followingFeedNotifierProvider.notifier);
    following.restartLive();
    unawaited(following.refresh());

    // Money moved while away (zaps, credits on another device).
    unawaited(_ref.read(walletSyncServiceProvider).syncNow());
    _ref.read(lnbitsLiveServiceProvider).resync();

    // DMs sent while dead — gap-fill fetches exactly the gap (the live
    // sub can't deliver retroactively). New arrivals notify via DmNotifier.
    await _ref.read(dmGapFillProvider).fillGap();
  }

  /// The scheduler seam. TODAY this is a no-op stub that documents the
  /// contract; the real registration is a ~20-line addition once the
  /// `workmanager` package is fetchable:
  ///
  /// ```dart
  /// await Workmanager().initialize(backgroundSyncDispatcher);
  /// await Workmanager().registerPeriodicTask(
  ///   'nostrfeed-bg-sync', 'nostrfeed-bg-sync',
  ///   frequency: const Duration(minutes: 15), // OS minimum
  ///   constraints: Constraints(networkType: NetworkType.connected),
  /// );
  /// ```
  ///
  /// …and the dispatcher (top-level, `@pragma('vm:entry-point')`):
  ///
  /// ```dart
  /// void backgroundSyncDispatcher() {
  ///   Workmanager().executeTask((_, _) async {
  ///     final container = ProviderContainer();
  ///     try {
  ///       await container.read(backgroundSyncServiceProvider).syncNow();
  ///       return true;
  ///     } finally {
  ///       container.dispose();
  ///     }
  ///   });
  /// }
  /// ```
  Future<void> registerPeriodicSync() async {
    // Intentionally empty — see the contract above. Kept as a method (not
    // a comment) so [setEnabled] and app start already call the right seam;
    // the workmanager glue lands inside this body without touching callers.
  }

  /// Cancel the periodic catch-up (user opted out).
  Future<void> unregisterPeriodicSync() async {
    // See registerPeriodicSync — `Workmanager().cancelByUniqueName(...)`.
  }
}

final backgroundSyncServiceProvider = Provider<BackgroundSyncService>(
  (ref) => BackgroundSyncService(ref),
);

/// Reactive view of the background-sync master switch for the Settings UI.
/// AsyncNotifier because the flag lives in SharedPreferences.
final backgroundSyncEnabledProvider =
    AsyncNotifierProvider<BackgroundSyncEnabledNotifier, bool>(
  BackgroundSyncEnabledNotifier.new,
);

class BackgroundSyncEnabledNotifier extends AsyncNotifier<bool> {
  @override
  Future<bool> build() =>
      ref.read(backgroundSyncServiceProvider).isEnabled();

  Future<void> toggle(bool enabled) async {
    state = AsyncData(enabled);
    await ref.read(backgroundSyncServiceProvider).setEnabled(enabled);
  }
}
