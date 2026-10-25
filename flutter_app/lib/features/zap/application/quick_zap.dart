import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/services/wallet_payment.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnurl_service.dart';

import 'package:shared_preferences/shared_preferences.dart';

/// The user's one-tap default zap amount (sats). Long-pressing the ⚡ button
/// on a post sends this instantly — no sheet — because every payment
/// decision has a mental cost (Szabo), and small zaps should cost zero
/// thought. Editable in the zap sheet; persisted per device.
final quickZapAmountProvider =
    NotifierProvider<QuickZapAmountNotifier, int>(QuickZapAmountNotifier.new);

class QuickZapAmountNotifier extends Notifier<int> {
  static const _key = 'zap:quick_amount_v1';
  static const defaultAmount = 21;

  @override
  int build() {
    _restore();
    return defaultAmount;
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getInt(_key);
    if (saved != null && saved > 0 && state == defaultAmount) {
      state = saved;
    }
  }

  Future<void> setAmount(int sats) async {
    if (sats <= 0) return;
    state = sats;
    // Debounced disk write — a slider/stepper fires this per tick, and each
    // was a full SharedPreferences round-trip. The in-memory state is always
    // current, so the write can lag.
    _writeTimer?.cancel();
    _writeTimer = Timer(const Duration(milliseconds: 300), () async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt(_key, sats);
    });
  }

  Timer? _writeTimer;
}

/// Above this, always show the full sheet — big spends deserve a decision.
const quickZapMaxSats = 100;

/// The outcome of a one-tap zap attempt.
enum QuickZapResult {
  /// Paid in-app; receipt will land on relays.
  sent,

  /// The target has no lightning address (or it can't be resolved).
  noAddress,

  /// No in-app wallet could pay — caller falls back to the full sheet.
  noWallet,

  /// Amount outside the recipient's min/max bounds.
  amountOutOfBounds,

  /// Login required (read-only / signed out).
  loginRequired,

  /// Something else failed — caller falls back to the full sheet.
  failed,
}

/// Sends a zap of [amountSats] to [event]'s author with NO user interaction:
/// resolve address → NIP-57 request → invoice → payWithAnyWallet. The whole
/// point is that small gratitude is one gesture, not a flow.
Future<QuickZapResult> sendQuickZap(
  ProviderReader read, {
  required NostrEvent event,
  String? targetPubkey,
  required int amountSats,
}) async {
  final auth = read(authStateProvider);
  if (!auth.isLoggedIn || auth.isReadOnly) {
    return QuickZapResult.loginRequired;
  }
  if (!hasPayingWallet(read)) {
    return QuickZapResult.noWallet;
  }

  final nostr = read(nostrServiceProvider);
  final pubkey = targetPubkey ?? event.pubkey;

  // ── Resolve the recipient's lightning address ────────────────────────
  final profile = await nostr.fetchProfile(pubkey);
  final address = profile?.lud16 ?? profile?.lud06;
  if (address == null || !address.contains('@')) {
    return QuickZapResult.noAddress;
  }
  final info = await resolveLnurlPay(address);
  if (info == null) return QuickZapResult.noAddress;
  if (amountSats < info.minSats || amountSats > info.maxSats) {
    return QuickZapResult.amountOutOfBounds;
  }

  // ── NIP-57 zap request (so the receipt shows on the post) ────────────
  String? zapRequestJson;
  if (info.allowsNostr) {
    final relays = nostr.relayPool.relayUrls.take(3).toList();
    final tags = <List<String>>[
      ['p', pubkey],
      ['amount', '${amountSats * 1000}'],
      ['relays', ...relays],
      ['e', event.id],
    ];
    final zapReq = nostr.authService.signEvent(
      privateKey: auth.privateKey!,
      kind: 9734,
      content: '',
      tags: tags,
    );
    zapRequestJson = encodeZapRequest(zapReq);
  }

  final invoice = await fetchInvoice(
    info: info,
    sats: amountSats,
    zapRequestJson: zapRequestJson,
  );
  if (invoice == null) return QuickZapResult.failed;

  // ── Pay with the first wallet that can ───────────────────────────────
  final paid = await payWithAnyWallet(read, invoice);
  return paid != null ? QuickZapResult.sent : QuickZapResult.noWallet;
}

/// URI-encoded zap-request event JSON (NIP-57 `nostr` param).
String encodeZapRequest(NostrEvent event) {
  final tags =
      '[${event.tags.map((t) => '[${t.map((v) => '"$v"').join(',')}]').join(',')}]';
  final content = event.content
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('\n', '\\n')
      .replaceAll('\r', '\\r')
      .replaceAll('\t', '\\t');
  return Uri.encodeComponent(
      '{"id":"${event.id}","pubkey":"${event.pubkey}","created_at":${event.createdAt},"kind":${event.kind},"tags":$tags,"content":"$content","sig":"${event.sig}"}');
}
