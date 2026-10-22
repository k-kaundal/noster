import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/auth_providers.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lndhub_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/nwc_providers.dart';

/// Keeps every money surface fresh without an app restart — the fix for
/// "I zapped / bought credits / received sats and the wallet didn't update".
///
/// Two triggers, both cheap and idempotent:
///  1. **Periodic** — every 30s while the app is in the foreground.
///  2. **On resume** — the moment the app returns to the foreground (called
///     from `didChangeAppLifecycleState`).
///
/// Refreshing is additive and safe: every underlying call re-fetches and
/// merges, never resets — and everything is skipped when that wallet isn't
/// connected (the common case for NWC/LndHub being unused).
final walletSyncServiceProvider = Provider<WalletSyncService>((ref) {
  final service = WalletSyncService(ref);
  service.start();
  ref.onDispose(service.stop);
  return service;
});

class WalletSyncService {
  final Ref _ref;
  Timer? _timer;

  /// Foreground cadence. 30s is frequent enough to feel live, sparse enough
  /// to cost nothing (each call is 1–3 GETs on connected wallets only).
  static const _interval = Duration(seconds: 30);

  WalletSyncService(this._ref);

  void start() {
    _timer?.cancel();
    _timer = Timer.periodic(_interval, (_) => syncNow());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// Refresh every connected money surface. Called by the timer, by app
  /// resume, and by anything that knows money just moved.
  Future<void> syncNow() async {
    // LNbits (primary) — balance + wallet list.
    if (_ref.read(lnbitsAuthProvider).isConnected) {
      _ref.read(lnbitsAuthProvider.notifier).refresh().ignore();
    }
    // NWC.
    if (_ref.read(nwcNotifierProvider).isConnected) {
      _ref.read(nwcNotifierProvider.notifier).refreshBalance().ignore();
    }
    // LndHub.
    if (_ref.read(lndHubProvider).isConnected) {
      _ref.read(lndHubProvider.notifier).refresh().ignore();
    }
    // AI credits — reconcile against the house-wallet history so credits
    // bought on another device (or granted while offline) appear without a
    // restart. Keyed on the NOSTR pubkey (what the top-up memo carries).
    final pubkey = _ref.read(authStateProvider).pubkey;
    if (pubkey != null && pubkey.isNotEmpty) {
      _ref.read(aiCreditsProvider.notifier).reconcile(pubkey).ignore();
    }
  }
}
