import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/services/wallet_payment.dart';
import 'package:nostrfeed_mobile/features/identity/application/address_providers.dart';
import 'package:nostrfeed_mobile/features/identity/data/address_service.dart';
import 'package:nostrfeed_mobile/features/premium/data/admission_service.dart';

/// Whether the current user has premium. For now this is inferred from
/// having a paid NIP-05 name (a bought name, not the free generated one) or
/// a paid lightning address — the paid relay + premium features unlock with
/// the same entitlement. A dedicated entitlement API can plug in later.
final isPremiumProvider = FutureProvider.autoDispose<bool>((ref) async {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return false;

  // Paid NIP-05 name (not the free u+12hex generated one, and ACTIVE — a
  // reserved-but-unpaid name grants nothing, it was never paid for).
  try {
    final nip5 = ref.watch(nip5Provider);
    for (final addr in nip5.addresses) {
      if (!addr.active) continue;
      final local = addr.localPart;
      if (local.isNotEmpty && !FreeAddress.isGenerated(local)) return true;
    }
  } catch (_) {}

  // Paid lightning address (not the free generated one).
  try {
    final lightning = ref.watch(lightningAddressProvider);
    for (final link in lightning.links) {
      final local = link.username ?? '';
      if (local.isNotEmpty && !FreeAddress.isGenerated(local)) return true;
    }
  } catch (_) {}

  return false;
});

final admissionServiceProvider = Provider<AdmissionService>(
  (ref) => const AdmissionService(),
);

/// Where a key stands with the paid relay — asked of the relay directly,
/// every time, rather than a purchase being remembered on the device.
///
/// Pass any pubkey (profile pages show the mark for other people too). A
/// failed check resolves to [AdmissionState.unknown], never unpaid — a
/// network/CORS failure is not the relay saying no.
final relayAdmissionProvider =
    FutureProvider.autoDispose.family<AdmissionState, String>((ref, pubkey) {
  return ref.watch(admissionServiceProvider).check(pubkey);
});

/// The signed-in user's own admission state.
final myAdmissionProvider = FutureProvider.autoDispose<AdmissionState>((ref) {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) {
    return AdmissionState.unknown;
  }
  return ref.watch(relayAdmissionProvider(auth.pubkey!).future);
});

/// The relay's own admission price, falling back to the documented one.
final admissionFeeProvider = FutureProvider.autoDispose<int>((ref) async {
  final quoted = await ref.watch(admissionServiceProvider).quoteFeeSats();
  return quoted ?? AdmissionService.fallbackAdmissionSats;
});

/// Paid relay status: admission state + whether the app is connected to the
/// premium relay (wss://paid.nostrfeed.com) via NIP-42 auth.
final paidRelayStatusProvider = FutureProvider.autoDispose<PaidRelayStatus>((
  ref,
) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final admission = await ref.watch(myAdmissionProvider.future);
  final connected = nostr.relayPool.connectedUrls.contains(Env.paidRelay);
  return PaidRelayStatus(
    url: Env.paidRelay,
    connected: connected,
    admission: admission,
  );
});

class PaidRelayStatus {
  final String url;
  final bool connected;
  final AdmissionState admission;
  const PaidRelayStatus({
    required this.url,
    required this.connected,
    this.admission = AdmissionState.unknown,
  });
}

/// Outcome of [connectPaidRelayProvider] — payment first, connect after.
enum PaidRelayConnectResult {
  /// Connected (already admitted, or payment confirmed).
  connected,

  /// The relay minted an invoice but no in-app wallet could pay it — the UI
  /// shows the QR/invoice so it can be paid from any wallet, then retried.
  invoicePending,

  /// Payment was sent but the relay has not admitted the key yet.
  awaitingAdmission,

  /// Could not reach the relay's admission endpoint.
  unreachable,
}

class PaidRelayConnectOutcome {
  final PaidRelayConnectResult result;
  final AdmissionInvoice? invoice;
  final String? error;
  const PaidRelayConnectOutcome(this.result, {this.invoice, this.error});
}

/// Connect to the paid relay — PAYMENT FIRST, connect after.
///
/// Flow (mirrors the web app's usePaidRelay):
/// 1. Ask the relay whether this key is admitted. If yes → just connect.
/// 2. If unpaid → mint an admission invoice from the relay and pay it with
///    whichever in-app wallet is available (LNbits → NWC → Cashu).
/// 3. If no wallet can pay → return the invoice so the UI can show the QR.
/// 4. After paying, poll the invoice status + admission check together
///    (either one saying yes is enough) — bounded, then connect.
/// NIP-42 auth itself happens automatically via the relay pool's authHandler.
final connectPaidRelayProvider =
    Provider<Future<PaidRelayConnectOutcome> Function()>((ref) {
  return () async {
    final auth = ref.read(authStateProvider);
    final pubkey = auth.pubkey;
    if (!auth.isLoggedIn || pubkey == null) {
      return const PaidRelayConnectOutcome(
        PaidRelayConnectResult.unreachable,
        error: 'Log in first',
      );
    }

    final nostr = ref.read(nostrServiceProvider);
    if (!nostr.isInitialized) await nostr.init();
    final service = ref.read(admissionServiceProvider);

    Future<PaidRelayConnectOutcome> connect() async {
      await nostr.relayPool.addRelay(Env.paidRelay);
      ref.invalidate(relayAdmissionProvider(pubkey));
      ref.invalidate(paidRelayStatusProvider);
      return const PaidRelayConnectOutcome(PaidRelayConnectResult.connected);
    }

    // ── Step 1: is the key already admitted? ──
    final state = await service.check(pubkey);
    if (state == AdmissionState.admitted) return connect();
    if (state == AdmissionState.unknown) {
      // A failed check is not a refusal — but without an answer there is no
      // way to mint an invoice either, so this is a reachability problem.
      return const PaidRelayConnectOutcome(
        PaidRelayConnectResult.unreachable,
        error: "Couldn't reach the relay to check this account.",
      );
    }

    // ── Step 2: unpaid → mint the invoice (payment comes first) ──
    final AdmissionInvoice invoice;
    try {
      invoice = await service.mintInvoice(pubkey);
    } catch (e) {
      return PaidRelayConnectOutcome(
        PaidRelayConnectResult.unreachable,
        error: e.toString(),
      );
    }
    // The relay answers a POST for an admitted key with no invoice.
    if (invoice.userAdmitted) return connect();
    final bolt11 = invoice.bolt11;
    if (bolt11 == null || bolt11.isEmpty) {
      return const PaidRelayConnectOutcome(
        PaidRelayConnectResult.unreachable,
        error: 'The relay did not return an invoice',
      );
    }

    // ── Step 3: pay with whichever wallet is available ──
    final paidWallet = await payWithAnyWallet(ref.read, bolt11);
    if (paidWallet == null) {
      return PaidRelayConnectOutcome(
        PaidRelayConnectResult.invoicePending,
        invoice: invoice,
      );
    }

    // ── Step 4: wait for the relay to admit the key, then connect ──
    final admitted = await _awaitAdmission(service, invoice, pubkey);
    if (admitted) return connect();
    return PaidRelayConnectOutcome(
      PaidRelayConnectResult.awaitingAdmission,
      invoice: invoice,
    );
  };
});

/// Watches an invoice until the payment registers — polls the relay's own
/// status route and the admission check together, because they can disagree
/// and either one saying yes is enough. Bounded (~1 minute): the payment has
/// to reach nostream and be processed, so checking once immediately after
/// paying reports unpaid, which is both wrong and alarming to somebody whose
/// sats have just left.
Future<bool> _awaitAdmission(
  AdmissionService service,
  AdmissionInvoice invoice,
  String pubkey,
) async {
  for (var attempt = 0; attempt < 20; attempt++) {
    await Future<void>.delayed(const Duration(seconds: 3));

    final statusUrl = invoice.statusUrl;
    final results = await Future.wait([
      statusUrl != null
          ? service.pollStatus(statusUrl)
          : Future.value(AdmissionInvoiceStatus.unknown),
      service.check(pubkey),
    ]);

    if (results[0] == AdmissionInvoiceStatus.completed ||
        results[1] == AdmissionState.admitted) {
      return true;
    }
    // Only the relay's own verdict expires an invoice.
    if (results[0] == AdmissionInvoiceStatus.expired) return false;
  }
  return false;
}

/// The user's premium names + lightning addresses for the premium screen.
class PremiumEntitlements {
  final List<String> nip5Names;
  final List<String> lightningAddresses;
  final bool hasPaidName;
  final bool hasPaidLightning;
  const PremiumEntitlements({
    this.nip5Names = const [],
    this.lightningAddresses = const [],
    this.hasPaidName = false,
    this.hasPaidLightning = false,
  });

  bool get hasAny => hasPaidName || hasPaidLightning;
}

final premiumEntitlementsProvider =
    FutureProvider.autoDispose<PremiumEntitlements>((ref) async {
      final nip5 = ref.watch(nip5Provider);
      final lightning = ref.watch(lightningAddressProvider);

      final names = <String>[];
      var hasPaidName = false;
      for (final addr in nip5.addresses) {
        final local = addr.localPart;
        if (local.isEmpty) continue;
        final host = nip5Host(addr.domainId);
        names.add('$local@$host');
        // Only an ACTIVE (paid & live) non-generated name is an entitlement.
        if (addr.active && !FreeAddress.isGenerated(local)) hasPaidName = true;
      }

      final lightnings = <String>[];
      var hasPaidLightning = false;
      for (final link in lightning.links) {
        final local = link.username ?? '';
        if (local.isEmpty) continue;
        final domain = link.domain ?? Env.lightningAddressDomain;
        lightnings.add('$local@$domain');
        if (!FreeAddress.isGenerated(local)) hasPaidLightning = true;
      }

      return PremiumEntitlements(
        nip5Names: names,
        lightningAddresses: lightnings,
        hasPaidName: hasPaidName,
        hasPaidLightning: hasPaidLightning,
      );
    });
