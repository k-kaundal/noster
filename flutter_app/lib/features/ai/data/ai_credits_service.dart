import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:nostrfeed_mobile/features/ai/data/ai_payment_tracker.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_credits.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnbits_service.dart';

/// One pending top-up: an invoice we minted and are waiting to settle.
class AiTopUpInvoice {
  final String paymentHash;
  final String bolt11;
  final AiCreditPack pack;

  const AiTopUpInvoice({
    required this.paymentHash,
    required this.bolt11,
    required this.pack,
  });
}

/// AI credits: purchase (LNbits invoices on the house wallet) + persistence.
///
/// Payment flow is serverless (docs/AI_PLAN.md §2): the invoice key can
/// create invoices AND read their payment status, but can never spend —
/// so embedding it is safe, and no backend is needed to confirm payment.
class AiCreditsService {
  static const _storageKey = 'ai:credits_v1';

  /// The payment hashes this device has already credited — the idempotency
  /// key for reconciliation. A payment must never credit twice (same device
  /// reconciling twice, or two devices reconciling the same payment).
  static const _creditedHashesKey = 'ai:credited_hashes_v1';

  final LnbitsService _lnbits;
  final FlutterSecureStorage _storage;
  final AiPaymentTracker _tracker;

  AiCreditsService({
    LnbitsService? lnbits,
    FlutterSecureStorage? storage,
    AiPaymentTracker? tracker,
  })  : _lnbits = lnbits ?? LnbitsService(),
        _storage = storage ?? const FlutterSecureStorage(),
        _tracker = tracker ?? AiPaymentTracker();

  bool get canTopUp => HouseWallet.isConfigured;

  // ── Purchase ───────────────────────────────────────────────────────────

  /// Mints a bolt11 invoice for [pack] on the house wallet.
  Future<AiTopUpInvoice> createTopUpInvoice(
    AiCreditPack pack, {
    required String buyerPubkey,
  }) async {
    final invoice = await _lnbits.createInvoice(
      apiKey: HouseWallet.invoiceKey,
      amountSats: pack.sats,
      memo: 'NostrFeed AI credits ${pack.label} · $buyerPubkey',
      expirySeconds: 1800,
    );
    return AiTopUpInvoice(
      paymentHash: invoice.paymentHash,
      bolt11: invoice.bolt11,
      pack: pack,
    );
  }

  /// True once the invoice is confirmed settled by LNbits (never a local
  /// record — same rule as `showPayInvoiceSheet`'s checkPaid).
  Future<bool> checkTopUpPaid(AiTopUpInvoice topUp) {
    return _lnbits.getInvoiceStatus(
      HouseWallet.invoiceKey,
      topUp.paymentHash,
    );
  }

  // ── Reconciliation (multi-device / reinstall) ──────────────────────────

  /// Finds settled top-ups by [pubkey] that THIS device hasn't credited
  /// yet, and returns the credits to grant (payment hashes recorded so a
  /// payment can never credit twice).
  ///
  /// Returns null when the wallet history can't be read — the caller
  /// treats null as "don't know" and changes nothing.
  Future<int?> reconcile(String pubkey) async {
    final payments = await _tracker.fetchAiPayments(pubkey);
    if (payments.isEmpty) return 0;

    final credited = await _creditedHashes();
    var granted = 0;
    final newHashes = <String>{};
    for (final p in payments) {
      if (p.paymentHash.isEmpty || credited.contains(p.paymentHash)) {
        continue;
      }
      granted += p.amountSats;
      newHashes.add(p.paymentHash);
    }
    if (newHashes.isEmpty) return 0;
    await _saveCreditedHashes(credited..addAll(newHashes));
    return granted;
  }

  /// Records a just-paid invoice hash so reconcile() skips it.
  Future<void> markCredited(String paymentHash) async {
    if (paymentHash.isEmpty) return;
    final credited = await _creditedHashes();
    credited.add(paymentHash);
    await _saveCreditedHashes(credited);
  }

  Future<Set<String>> _creditedHashes() async {
    try {
      final raw = await _storage.read(key: _creditedHashesKey);
      if (raw == null) return <String>{};
      final list = jsonDecode(raw);
      if (list is List) return list.map((e) => '$e').toSet();
    } catch (_) {}
    return <String>{};
  }

  Future<void> _saveCreditedHashes(Set<String> hashes) {
    return _storage.write(
      key: _creditedHashesKey,
      value: jsonEncode(hashes.toList()),
    );
  }

  // ── Persistence ────────────────────────────────────────────────────────

  Future<AiCreditsLedger> load() async {
    try {
      final raw = await _storage.read(key: _storageKey);
      if (raw == null) return const AiCreditsLedger();
      final json = jsonDecode(raw);
      if (json is Map<String, dynamic>) return AiCreditsLedger.fromJson(json);
    } catch (_) {
      // Corrupted store → zeroed ledger (checksum guard also covers this).
    }
    return const AiCreditsLedger();
  }

  Future<void> save(AiCreditsLedger ledger) {
    return _storage.write(
      key: _storageKey,
      value: jsonEncode(ledger.toJson()),
    );
  }
}
