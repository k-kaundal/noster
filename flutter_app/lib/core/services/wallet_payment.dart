import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/features/wallet/providers/cashu_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/nwc_providers.dart';

/// Which in-app wallet paid (or would pay) an invoice.
enum WalletKind { lnbits, nwc, cashu }

/// The `.read` of either a `Ref` (providers) or a `WidgetRef` (widgets) —
/// Riverpod 2.6 has no shared interface for the two, but both expose a
/// `.read` with this exact shape, so a tear-off of either works here.
typedef ProviderReader = T Function<T>(ProviderListenable<T> provider);

/// Whether ANY in-app wallet can attempt a payment right now.
bool hasPayingWallet(ProviderReader read) {
  final lnbits = read(lnbitsAuthProvider);
  final wallet = lnbits.account?.wallets.isEmpty == false
      ? lnbits.account!.wallets.first
      : null;
  if (lnbits.isConnected && (wallet?.adminkey ?? wallet?.inkey) != null) {
    return true;
  }
  if (read(nwcNotifierProvider).isConnected) return true;
  if (read(cashuWalletProvider).totalSats > 0) return true;
  return false;
}

/// Pays a bolt11 invoice with the first in-app wallet that can: built-in
/// LNbits (custodial, one tap) → external NWC (NIP-47) → Cashu ecash.
///
/// Returns the wallet that paid, or null when no wallet is connected or
/// every attempt failed — the caller then shows the invoice QR so it can be
/// paid from any external wallet.
Future<WalletKind?> payWithAnyWallet(
  ProviderReader read,
  String bolt11,
) async {
  // 1. Built-in LNbits wallet.
  try {
    final lnbits = read(lnbitsAuthProvider);
    final wallet = lnbits.account?.wallets.isEmpty == false
        ? lnbits.account!.wallets.first
        : null;
    final adminKey = wallet?.adminkey ?? wallet?.inkey;
    if (lnbits.isConnected && adminKey != null) {
      await read(lnbitsServiceProvider).payInvoice(
            apiKey: adminKey,
            bolt11: bolt11,
          );
      return WalletKind.lnbits;
    }
  } catch (_) {
    // Fall through to the next wallet — a failed LNbits payment (e.g.
    // insufficient balance) should not block NWC/Cashu.
  }

  // 2. External wallet over NWC (NIP-47).
  try {
    final nwc = read(nwcNotifierProvider);
    if (nwc.isConnected) {
      await read(nwcNotifierProvider.notifier).payInvoice(bolt11);
      return WalletKind.nwc;
    }
  } catch (_) {}

  // 3. Cashu ecash.
  try {
    final cashu = read(cashuWalletProvider);
    if (cashu.totalSats > 0) {
      final result =
          await read(cashuWalletProvider.notifier).meltInvoice(bolt11);
      if (result.paid) return WalletKind.cashu;
    }
  } catch (_) {}

  return null;
}
