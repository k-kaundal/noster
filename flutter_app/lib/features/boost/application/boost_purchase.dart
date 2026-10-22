import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/kinds.dart';
import 'package:nostrfeed_mobile/core/providers/auth_providers.dart';
import 'package:nostrfeed_mobile/core/providers/nostr_service_providers.dart';
import 'package:nostrfeed_mobile/core/services/wallet_payment.dart';
import 'package:nostrfeed_mobile/features/boost/application/boost_providers.dart';
import 'package:nostrfeed_mobile/features/boost/domain/boost.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnurl_service.dart';
import 'package:nostrfeed_mobile/features/zap/application/quick_zap.dart';

/// The buy flow's progress, surfaced in the boost sheet.
enum BoostPurchaseStage {
  idle,
  resolving,
  paying,
  awaitingReceipt,
  done,
  failed,
}

class BoostPurchaseState {
  final BoostPurchaseStage stage;
  final String? error;

  const BoostPurchaseState({
    this.stage = BoostPurchaseStage.idle,
    this.error,
  });
}

/// Buys a boost for a note: zap [tier] sats to the platform's lightning
/// address with the note `e`-tagged in the zap request, then wait for the
/// receipt to land on relays (that's the moment the boost goes live).
///
/// The receipt IS the fulfilment — no server, no webhook, no "restore
/// purchase" button. If the receipt doesn't appear the sats still moved
/// (a zap is irreversible), so the sheet says so up front.
class BoostPurchaseNotifier extends Notifier<BoostPurchaseState> {
  @override
  BoostPurchaseState build() => const BoostPurchaseState();

  void reset() => state = const BoostPurchaseState();

  Future<void> buy(NostrEvent event, BoostTier tier) async {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly || auth.privateKey == null) {
      state = const BoostPurchaseState(
        stage: BoostPurchaseStage.failed,
        error: 'Sign in with a full key to boost a post.',
      );
      return;
    }
    if (!hasPayingWallet(ref.read)) {
      state = const BoostPurchaseState(
        stage: BoostPurchaseStage.failed,
        error: 'Connect a wallet first (Wallet tab).',
      );
      return;
    }

    state = const BoostPurchaseState(stage: BoostPurchaseStage.resolving);
    final info = await resolveLnurlPay(Env.platformLightningAddress);
    if (info == null || !info.allowsNostr) {
      state = const BoostPurchaseState(
        stage: BoostPurchaseStage.failed,
        error: 'Boosts are not available right now — try again later.',
      );
      return;
    }
    if (tier.priceSats < info.minSats || tier.priceSats > info.maxSats) {
      state = BoostPurchaseState(
        stage: BoostPurchaseStage.failed,
        error:
            'This amount is outside the platform\'s limits '
            '(${info.minSats}–${info.maxSats} sats).',
      );
      return;
    }

    // ── NIP-57 zap request: p=platform, e=the boosted note ──────────────
    final nostr = ref.read(nostrServiceProvider);
    final relays = nostr.relayPool.relayUrls.take(3).toList();
    final zapReq = nostr.authService.signEvent(
      privateKey: auth.privateKey!,
      kind: NostrKinds.zapRequest,
      content: '',
      tags: [
        ['p', Env.operatorPubkey],
        ['amount', '${tier.priceSats * 1000}'],
        ['relays', ...relays],
        ['e', event.id],
      ],
    );

    state = const BoostPurchaseState(stage: BoostPurchaseStage.paying);
    final invoice = await fetchInvoice(
      info: info,
      sats: tier.priceSats,
      zapRequestJson: encodeZapRequest(zapReq),
    );
    if (invoice == null) {
      state = const BoostPurchaseState(
        stage: BoostPurchaseStage.failed,
        error: 'Could not get an invoice from the platform.',
      );
      return;
    }
    final paid = await payWithAnyWallet(ref.read, invoice);
    if (paid == null) {
      state = const BoostPurchaseState(
        stage: BoostPurchaseStage.failed,
        error: 'Payment failed — check your wallet balance.',
      );
      return;
    }

    // ── Wait for the receipt on relays = the boost going live ────────────
    state =
        const BoostPurchaseState(stage: BoostPurchaseStage.awaitingReceipt);
    final seen = await _awaitReceipt(event.id);
    // Refresh the boosts list either way — the receipt may already be in
    // the pool from another relay.
    ref.invalidate(boostReceiptsProvider);

    state = BoostPurchaseState(
      stage: BoostPurchaseStage.done,
      error: seen
          ? null
          : 'Paid — the receipt is taking a moment to appear. '
              'Your boost will show up shortly.',
    );
  }

  /// Subscribes for the receipt of THIS boost (p=platform, e=note) with a
  /// bounded wait — the LNURL server publishes seconds after settlement.
  Future<bool> _awaitReceipt(String noteId) async {
    final nostr = ref.read(nostrServiceProvider);
    final since = DateTime.now().millisecondsSinceEpoch ~/ 1000 - 60;
    try {
      await for (final _ in nostr.relayPool.subscribe([
        NostrFilter(
          kinds: [NostrKinds.zapReceipt],
          pTags: [Env.operatorPubkey],
          eTags: [noteId],
          since: since,
        ),
      ]).timeout(const Duration(seconds: 45))) {
        return true; // first matching receipt is enough
      }
    } catch (_) {
      // Timeout or socket error — the receipt may still land later.
    }
    return false;
  }
}
