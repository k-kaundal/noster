import 'dart:async';

import 'package:flutter/foundation.dart' show defaultTargetPlatform, TargetPlatform;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/nostr/sync/negentropy_sync_service.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_gap_fill.dart';
import 'package:nostrfeed_mobile/features/feed/application/feed_notifier.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_live_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/wallet_sync_service.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

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

    // ADR-0007 P5: NIP-77 set reconciliation against the connected relays
    // (bandwidth ∝ the DIFFERENCE, not the window). Relays without NEG
    // support are skipped silently — the feed refresh below still covers
    // them via the classic windowed REQ path.
    final connected = nostr.relayPool.connectedUrls;
    if (connected.isNotEmpty) {
      unawaited(
        _ref.read(negentropySyncServiceProvider).syncFeedScope(connected),
      );
    }

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

  /// The scheduler seam — registers the periodic OS task. `syncNow` runs on
  /// a FRESH [ProviderContainer] in the background isolate (the foreground
  /// container doesn't exist there); the task body is exactly one catch-up
  /// pass. Frequency is the documented cadence — the OS may stretch it
  /// under Doze; that's the battery-cheap trade this tier makes on purpose.
  Future<void> registerPeriodicSync() async {
    await Workmanager().initialize(backgroundSyncDispatcher);
    await Workmanager().registerPeriodicTask(
      _taskName,
      _taskName,
      frequency: _syncInterval,
      constraints: Constraints(networkType: NetworkType.connected),
      // Never replace a queued/scheduled task with a re-registration (app
      // update / toggle off→on) — keep the OS's existing schedule.
      existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
    );
  }

  /// Cancel the periodic catch-up (user opted out).
  Future<void> unregisterPeriodicSync() async {
    await Workmanager().cancelByUniqueName(_taskName);
  }

  static const _taskName = 'nostrfeed-bg-sync';
  // OS-enforced minimum for periodic work is 15 min; an hour is the honest
  // battery-cheap cadence for catch-up (the research-backed tier — see the
  // class doc). Tighten only with a product call.
  static const _syncInterval = Duration(hours: 1);

  // ── Phase 4 (ADR-0007): the bounded sync window (dataSync FGS) ─────────
  //
  // Android 15 caps `dataSync` foreground services at 6 h/24 h and Google
  // explicitly recommends WorkManager over a hand-rolled FGS — so the
  // "stay synced in the background" tier is an EXPEDITED one-off task that
  // WorkManager promotes to a dataSync FGS while it runs. No manifest
  // changes, no Play FGS justification, no `BOOT_COMPLETED` (which Android
  // 15 forbids for dataSync). The task self-reschedules while the window
  // toggle is ON, giving continuous coverage that degrades gracefully under
  // quota/Doze to the hourly periodic catch-up above.
  static const windowTaskName = 'nostrfeed-bg-sync-window';
  static const _windowEnabledKey = 'settings:sync_window_enabled';
  // How long one window task syncs before finishing and re-queueing. Kept
  // short so the OS's expedited/dataSync quota is respected and the task
  // ends cleanly instead of being reaped.
  static const windowDuration = Duration(minutes: 20);

  /// The opt-in master switch for the continuous sync window (default OFF
  /// — it's the battery-heavier tier; the hourly catch-up stays the cheap
  /// default).
  Future<bool> isWindowEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_windowEnabledKey) ?? false;
  }

  Future<void> setWindowEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_windowEnabledKey, enabled);
    if (enabled) {
      await scheduleSyncWindow();
    } else {
      await Workmanager().cancelByUniqueName(windowTaskName);
    }
  }

  /// Queue the next sync-window task (expedited + dataSync FGS on Android).
  /// Called when the toggle turns on and re-chained by the background
  /// dispatcher while the toggle stays on. Android-only: iOS has no FGS
  /// concept — the periodic BGTaskScheduler catch-up is the only tier there.
  Future<void> scheduleSyncWindow() async {
    if (!syncWindowSupported) return;
    await Workmanager().initialize(backgroundSyncDispatcher);
    await Workmanager().registerOneOffTask(
      windowTaskName,
      windowTaskName,
      expedited: true,
      outOfQuotaPolicy: OutOfQuotaPolicy.runAsNonExpeditedWorkRequest,
      constraints: Constraints(networkType: NetworkType.connected),
      existingWorkPolicy: ExistingWorkPolicy.keep,
      inputData: const {'window': true},
      foregroundServiceConfig: ForegroundServiceConfig(
        notificationTitle: 'NostrFeed sync',
        notificationText: 'Keeping your feed up to date',
        notificationChannelId: 'sync_window',
        notificationChannelName: 'Background sync',
        foregroundServiceType: ForegroundServiceType.dataSync,
      ),
    );
  }
}

/// Background entry point. MUST be top-level and `@pragma('vm:entry-point')`
/// so the AOT tree-shaker keeps it reachable from the native side — the OS
/// spawns a headless Flutter engine that looks this symbol up by name.
@pragma('vm:entry-point')
void backgroundSyncDispatcher() {
  Workmanager().executeTask((taskName, inputData) async {
    final container = ProviderContainer();
    try {
      final service = container.read(backgroundSyncServiceProvider);
      final isWindow = inputData?['window'] == true ||
          taskName == BackgroundSyncService.windowTaskName;
      if (isWindow) {
        await _runSyncWindow(container, service);
      } else {
        await service.syncNow();
      }
      return true;
    } finally {
      container.dispose();
    }
  });
}

/// Phase 4: one bounded sync-window pass inside the dataSync FGS. Syncs for
/// [BackgroundSyncService.windowDuration], then re-queues itself while the
/// user toggle stays on. Every step is failure-safe; a quota/Doze kill just
/// drops back to the hourly periodic catch-up.
Future<void> _runSyncWindow(
  ProviderContainer container,
  BackgroundSyncService service,
) async {
  // Toggle off mid-window → stop, don't re-chain.
  if (!await service.isWindowEnabled()) return;

  // Initial catch-up (reconnect relays, restart live tails, refresh feeds).
  await service.syncNow();

  // Hold the window open for the bounded duration: the live tails (restarted
  // above) deliver new events into the store as they arrive. Periodic nudges
  // re-run syncNow so a dropped socket re-heals inside the window.
  final deadline = DateTime.now().add(BackgroundSyncService.windowDuration);
  while (DateTime.now().isBefore(deadline)) {
    await Future<void>.delayed(const Duration(minutes: 2));
    if (!await service.isWindowEnabled()) return; // user turned it off
    await service.syncNow();
  }

  // Window over — re-chain the next one while the toggle stays on. WorkManager
  // coalesces (ExistingWorkPolicy.keep) and may delay under quota/Doze; the
  // hourly periodic task is the guaranteed floor.
  if (await service.isWindowEnabled()) {
    await service.scheduleSyncWindow();
  }
}

final backgroundSyncServiceProvider = Provider<BackgroundSyncService>(
  (ref) => BackgroundSyncService(ref),
);

/// Whether the Phase-4 continuous sync window (dataSync FGS) exists on this
/// platform — Android only. The Settings UI hides the toggle off-Android and
/// [BackgroundSyncService.scheduleSyncWindow] no-ops there.
bool get syncWindowSupported => defaultTargetPlatform == TargetPlatform.android;

/// Reactive view of the Phase-4 continuous sync-window toggle (Android
/// dataSync FGS). Default OFF — the hourly catch-up stays the cheap default.
final syncWindowEnabledProvider =
    AsyncNotifierProvider<SyncWindowEnabledNotifier, bool>(
  SyncWindowEnabledNotifier.new,
);

class SyncWindowEnabledNotifier extends AsyncNotifier<bool> {
  @override
  Future<bool> build() =>
      ref.read(backgroundSyncServiceProvider).isWindowEnabled();

  Future<void> toggle(bool enabled) async {
    state = const AsyncData(false);
    await ref.read(backgroundSyncServiceProvider).setWindowEnabled(enabled);
    state = AsyncData(enabled);
  }
}

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
