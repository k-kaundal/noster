import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/features/wallet/application/cashu_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lndhub_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/nwc_providers.dart';

/// Which in-app wallet paid (or would pay) an invoice.
enum WalletKind { lnbits, nwc, cashu, lndhub }

/// The `.read` of either a `Ref` (providers) or a `WidgetRef` (widgets) —
/// Riverpod 2.6 has no shared interface for the two, but both expose a
/// `.read` with this exact shape, so a tear-off of either works here.
typedef ProviderReader = T Function<T>(ProviderListenable<T> provider);

/// Whether ANY in-app wallet can attempt a payment right now.
bool hasPayingWallet(ProviderReader read) {
  final lnbits = read(lnbitsAuthProvider);
  final wallet = lnbits.activeWallet;
  if (lnbits.isConnected && (wallet?.adminkey ?? wallet?.inkey) != null) {
    return true;
  }
  if (read(nwcNotifierProvider).isConnected) return true;
  if (read(cashuWalletProvider).totalSats > 0) return true;
  if (read(lndHubProvider).isConnected) return true;
  return false;
}

/// Pays a bolt11 invoice with the first in-app wallet that can: built-in
/// LNbits (custodial, one tap) → external NWC (NIP-47) → Cashu ecash →
/// LndHub hub account.
///
/// Returns the wallet that paid, or null when no wallet is connected or
/// every attempt failed — the caller then shows the invoice QR so it can be
/// paid from any external wallet.
///
/// On success the paying wallet's balance is refreshed — a payment that
/// leaves the balance stale was the "zap doesn't show in wallet" bug.
Future<WalletKind?> payWithAnyWallet(
  ProviderReader read,
  String bolt11,
) async {
  final paid = await _payWithAnyWalletInner(read, bolt11);
  if (paid != null) _refreshWalletAfterPayment(read, paid);
  return paid;
}

Future<WalletKind?> _payWithAnyWalletInner(
  ProviderReader read,
  String bolt11,
) async {
  // 1. Built-in LNbits wallet.
  try {
    final lnbits = read(lnbitsAuthProvider);
    final wallet = lnbits.activeWallet;
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

  // 4. LndHub hub account (BlueWallet/Zeus/Alby-style custodial QR).
  try {
    final hub = read(lndHubProvider);
    if (hub.isConnected) {
      await read(lndHubProvider.notifier).payInvoice(bolt11);
      return WalletKind.lndhub;
    }
  } catch (_) {}

  return null;
}

/// Re-fetches the balance of the wallet that just paid — fire-and-forget,
/// never blocks the caller's success path.
void _refreshWalletAfterPayment(ProviderReader read, WalletKind kind) {
  switch (kind) {
    case WalletKind.lnbits:
      read(lnbitsAuthProvider.notifier).refresh().ignore();
    case WalletKind.nwc:
      read(nwcNotifierProvider.notifier).refreshBalance().ignore();
    case WalletKind.cashu:
      // Cashu proofs are already consumed locally by meltInvoice.
    case WalletKind.lndhub:
      read(lndHubProvider.notifier).refresh().ignore();
  }
}

/// Pays with a SPECIFIC wallet (the one the user picked in the pay sheet).
/// Returns true when the payment was sent; false when that wallet can't pay
/// (not connected, no key, or the payment failed) — the caller falls back
/// to the QR.
Future<bool> payWithWallet(
  ProviderReader read,
  WalletKind kind,
  String bolt11,
) async {
  final paid = await _payWithWalletInner(read, kind, bolt11);
  if (paid) _refreshWalletAfterPayment(read, kind);
  return paid;
}

Future<bool> _payWithWalletInner(
  ProviderReader read,
  WalletKind kind,
  String bolt11,
) async {
  switch (kind) {
    case WalletKind.lnbits:
      final lnbits = read(lnbitsAuthProvider);
      final wallet = lnbits.activeWallet;
      final adminKey = wallet?.adminkey ?? wallet?.inkey;
      if (!lnbits.isConnected || adminKey == null) return false;
      try {
        await read(lnbitsServiceProvider).payInvoice(
          apiKey: adminKey,
          bolt11: bolt11,
        );
        return true;
      } catch (_) {
        return false;
      }
    case WalletKind.nwc:
      final nwc = read(nwcNotifierProvider);
      if (!nwc.isConnected) return false;
      try {
        await read(nwcNotifierProvider.notifier).payInvoice(bolt11);
        return true;
      } catch (_) {
        return false;
      }
    case WalletKind.cashu:
      final cashu = read(cashuWalletProvider);
      if (cashu.totalSats <= 0) return false;
      try {
        final result =
            await read(cashuWalletProvider.notifier).meltInvoice(bolt11);
        return result.paid;
      } catch (_) {
        return false;
      }
    case WalletKind.lndhub:
      final hub = read(lndHubProvider);
      if (!hub.isConnected) return false;
      try {
        await read(lndHubProvider.notifier).payInvoice(bolt11);
        return true;
      } catch (_) {
        return false;
      }
  }
}

/// One selectable wallet in the pay sheet's picker.
class WalletOption {
  final WalletKind kind;
  final String label;
  final String? detail;

  const WalletOption(this.kind, this.label, {this.detail});
}

/// The wallets the user can pick from RIGHT NOW (connected / funded), in
/// the order they're shown. Empty = no in-app wallet → the sheet shows only
/// the QR.
List<WalletOption> availableWallets(ProviderReader read) {
  final options = <WalletOption>[];

  final lnbits = read(lnbitsAuthProvider);
  final wallet = lnbits.activeWallet;
  if (lnbits.isConnected && (wallet?.adminkey ?? wallet?.inkey) != null) {
    options.add(WalletOption(
      WalletKind.lnbits,
      wallet?.name ?? 'NostrFeed wallet',
      detail: '${wallet?.balanceSats ?? 0} sats',
    ));
  }

  final nwc = read(nwcNotifierProvider);
  if (nwc.isConnected) {
    options.add(WalletOption(
      WalletKind.nwc,
      nwc.activeConnection?.alias ?? 'NWC wallet',
      detail: 'Nostr Wallet Connect',
    ));
  }

  final cashu = read(cashuWalletProvider);
  if (cashu.totalSats > 0) {
    options.add(WalletOption(
      WalletKind.cashu,
      'Cashu ecash',
      detail: '${cashu.totalSats} sats',
    ));
  }

  final hub = read(lndHubProvider);
  if (hub.isConnected) {
    options.add(WalletOption(
      WalletKind.lndhub,
      'LndHub',
      detail: hub.credentials?.host.replaceFirst('https://', ''),
    ));
  }

  return options;
}
