import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/auth_providers.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnbits_live_service.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnbits_service.dart';

/// Realtime wallet updates over the LNbits websocket (`/api/v1/ws/{inkey}`).
///
/// This is the PRIMARY freshness channel for the built-in LNbits wallet —
/// the 30s `WalletSyncService` poll stays as the fallback when the socket
/// is down (proxy idle timeouts kill quiet sockets; never assume it stays
/// connected, so reconnect is driven by [onDone] + app resume).
///
/// Three things happen on every pushed payment:
///  1. The wallet state refreshes (debounced — a zap storm is one fetch).
///  2. An incoming settled payment fires a local push notification and an
///     in-app banner, so received sats show up instantly.
///  3. A payment matching an AI-credits top-up memo triggers an immediate
///     reconcile — credits land seconds after the payer's wallet confirms,
///     without the "I've paid — check" tap.
final lnbitsLiveServiceProvider = Provider<LnbitsLiveCoordinator>((ref) {
  final coordinator = LnbitsLiveCoordinator(ref);
  ref.onDispose(coordinator.dispose);
  // (Re)wire whenever the active wallet changes (connect / switch / logout).
  ref.listen(lnbitsActiveWalletProvider, (_, _) => coordinator.resync());
  coordinator.resync();
  return coordinator;
});

/// The last incoming payment seen on the live socket — drives the in-app
/// "received sats" banner. Null when nothing new.
final lnbitsLiveAlertProvider = StateProvider<LnbitsLivePayment?>((_) => null);

class LnbitsLiveCoordinator {
  final Ref _ref;
  final LnbitsLiveService _wallet = LnbitsLiveService();
  final LnbitsLiveService _house = LnbitsLiveService();

  Timer? _walletReconnect;
  Timer? _houseReconnect;
  Timer? _refreshDebounce;
  var _disposed = false;

  /// In-flight reconnect backoff per socket (resets on a clean connect).
  var _walletFailures = 0;
  var _houseFailures = 0;

  LnbitsLiveCoordinator(this._ref);

  void resync() {
    if (_disposed) return;
    _syncWalletSocket();
    _syncHouseSocket();
  }

  // ── User's active wallet ─────────────────────────────────────────────

  void _syncWalletSocket() {
    final wallet = _ref.read(lnbitsActiveWalletProvider);
    final inkey = wallet?.inkey;
    if (inkey == null || inkey.isEmpty) {
      unawaited(_wallet.close());
      _walletReconnect?.cancel();
      return;
    }
    if (_wallet.isConnected) return; // already live on the right key
    _connectWallet(inkey);
  }

  void _connectWallet(String inkey) {
    unawaited(_wallet.connect(
      baseUrl: lnbitsUrl, // the active instance — same as REST calls
      invoiceKey: inkey,
      onPayment: _onWalletPayment,
      onDone: () {
        if (_disposed) return;
        _walletFailures++;
        _walletReconnect?.cancel();
        // 5s → 10s → 20s … capped at 2min, like the relay pool backoff.
        final secs = (5 << (_walletFailures - 1)).clamp(5, 120);
        _walletReconnect = Timer(Duration(seconds: secs), () {
          if (!_disposed) _syncWalletSocket();
        });
      },
    ).then((_) {
      if (_wallet.isConnected) _walletFailures = 0;
    }));
  }

  void _onWalletPayment(LnbitsLivePayment payment) {
    // 1. Refresh the account (balance + wallets + payments) — debounced
    //    so a burst of events costs ONE GET /api/v1/auth.
    _refreshDebounce?.cancel();
    _refreshDebounce = Timer(const Duration(milliseconds: 600), () {
      if (_disposed) return;
      _ref.read(lnbitsAuthProvider.notifier).refresh().ignore();
    });

    // 2. Notify on incoming settled sats (skip pending/outgoing echoes).
    if (payment.isIncoming && payment.status != 'pending') {
      final sats = (payment.amountMsat ?? 0) ~/ 1000;
      if (sats > 0) {
        LocalNotificationService.instance.showZap(
          zapperName: 'Wallet',
          sats: sats,
        );
        _ref.read(lnbitsLiveAlertProvider.notifier).state = payment;
      }
    }
  }

  // ── House wallet (AI credits) ────────────────────────────────────────

  /// A second socket on the house wallet's receive-only invoice key —
  /// top-ups land in realtime, so credits reconcile the moment the payer's
  /// wallet settles instead of waiting for "I've paid" or the 30s poll.
  void _syncHouseSocket() {
    if (!HouseWallet.isConfigured) {
      unawaited(_house.close());
      return;
    }
    if (_house.isConnected) return;
    // The house wallet lives on the OPERATOR instance — the same pin as
    // AiCreditsService / AiPaymentTracker (never the Settings override).
    final base = defaultLnbitsUrl;
    unawaited(_house.connect(
      baseUrl: base,
      invoiceKey: HouseWallet.invoiceKey,
      onPayment: _onHousePayment,
      onDone: () {
        if (_disposed) return;
        _houseFailures++;
        _houseReconnect?.cancel();
        final secs = (5 << (_houseFailures - 1)).clamp(5, 120);
        // Stored (like _walletReconnect) so dispose/resync can cancel it —
        // an unassigned timer stacked reconnects after wallet churn.
        _houseReconnect = Timer(Duration(seconds: secs), () {
          if (!_disposed) _syncHouseSocket();
        });
      },
    ).then((_) {
      if (_house.isConnected) _houseFailures = 0;
    }));
  }

  void _onHousePayment(LnbitsLivePayment payment) {
    if (!payment.isIncoming) return;
    // Any incoming house payment MIGHT be an AI top-up — reconcile is
    // memo-filtered + idempotent, so running it on every event is safe.
    final pubkey = _ref.read(authStateProvider).pubkey;
    if (pubkey == null || pubkey.isEmpty) return;
    _ref.read(aiCreditsProvider.notifier).reconcile(pubkey).ignore();
  }

  void dispose() {
    _disposed = true;
    _walletReconnect?.cancel();
    _houseReconnect?.cancel();
    _refreshDebounce?.cancel();
    unawaited(_wallet.close());
    unawaited(_house.close());
  }
}
