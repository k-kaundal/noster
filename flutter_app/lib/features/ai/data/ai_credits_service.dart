import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
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
///
/// UNITS: the ledger holds TOKENS (1 token = $0.001 — see `tokensPerUsd`).
/// Ledgers written in the sats era (1 credit = 1 sat) are migrated once by
/// [load], converting sats → tokens at the current rate, so an existing
/// balance keeps its dollar value across the unit change.
class AiCreditsService {
  static const _storageKey = 'ai:credits_v1';

  /// The payment hashes this device has already credited — the idempotency
  /// key for reconciliation. A payment must never credit twice (same device
  /// reconciling twice, or two devices reconciling the same payment).
  static const _creditedHashesKey = 'ai:credited_hashes_v1';

  /// One-time unit-migration flag: ledgers written before credits became
  /// tokens are converted sats → tokens at first load after the upgrade.
  static const _migratedToTokensKey = 'ai:credits_migrated_to_tokens_v1';

  /// Sats → tokens conversion used when migrating an OLD sats-denominated
  /// ledger (≈ $80k BTC). Only ever applies to pre-token balances, so a
  /// slight rate drift changes nothing in dollars.
  static const migrationSatsPerUsd = 1227.0;

  final LnbitsService _lnbits;
  final FlutterSecureStorage _storage;
  final AiPaymentTracker _tracker;

  AiCreditsService({
    LnbitsService? lnbits,
    FlutterSecureStorage? storage,
    AiPaymentTracker? tracker,
  }) : _lnbits =
           lnbits ??
           // The OPERATOR instance, always — the HouseWallet keys only
           // exist there (same pin as nostrnip5 / lnurlp / bunker /
           // wallet tools). A no-arg LnbitsService() would follow the
           // Settings URL override and mint invoices on a server where
           // the house key is invalid, while reconcile searched the
           // operator one — paid, but credits never found.
           LnbitsService(baseUrl: Env.lnbitsUrl.replaceAll(RegExp(r'/+$'), '')),
       _storage = storage ?? const FlutterSecureStorage(),
       _tracker = tracker ?? AiPaymentTracker();

  bool get canTopUp => HouseWallet.isConfigured;

  // ── Purchase ───────────────────────────────────────────────────────────

  /// Mints a bolt11 invoice for [pack] on the house wallet, at [priceSats]
  /// (the pack's token value in sats at the live rate — computed by the
  /// caller, where the rate provider lives).
  ///
  /// The memo ALWAYS carries the identifying prefix + the buyer's pubkey —
  /// reconciliation (`AiPaymentTracker.isAiCreditMemo`) matches on both, so
  /// a purchase whose memo loses them becomes unrecoverable. [memoNote]
  /// only APPENDS a human note (fee/bonus detail) after the prefix.
  Future<AiTopUpInvoice> createTopUpInvoice(
    AiCreditPack pack, {
    required int priceSats,
    required String buyerPubkey,
    String? memoNote,
  }) async {
    final base = 'NostrFeed AI credits ${pack.label} · $buyerPubkey';
    final invoice = await _lnbits.createInvoice(
      apiKey: HouseWallet.invoiceKey,
      amountSats: priceSats,
      memo: memoNote == null ? base : '$base · $memoNote',
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
    return _lnbits.getInvoiceStatus(HouseWallet.invoiceKey, topUp.paymentHash);
  }

  // ── Reconciliation (multi-device / reinstall) ──────────────────────────

  /// In-flight reconcile — concurrent callers share one run so two
  /// reconciles can never read the same "uncredited" state and grant
  /// the same payment twice.
  Future<int?>? _inflightReconcile;

  /// Finds settled top-ups by [pubkey] that THIS device hasn't credited
  /// yet, CREDITS them onto the on-disk ledger, and returns the granted
  /// amount (payment hashes recorded so a payment can never credit twice).
  ///
  /// Each settled payment's SATS are converted to tokens at [satsPerUsd]
  /// (the live rate, passed by the caller from `aiSatsPerUsdProvider`) so a
  /// recovered top-up grants its true current dollar value — never a stale
  /// hardcoded rate.
  ///
  /// The credit happens HERE, atomically with the hash recording — the
  /// "payment done, credits still 0" bug was the hashes being recorded
  /// while the granted amount was returned and discarded, after which
  /// every later reconcile skipped those payments as already-credited.
  ///
  /// Returns null when the wallet history can't be read — the caller
  /// treats null as "don't know" and changes nothing.
  Future<int?> reconcile(String pubkey, {double? satsPerUsd}) {
    final running = _inflightReconcile;
    if (running != null) return running;
    final task = _reconcileInner(pubkey, satsPerUsd: satsPerUsd).whenComplete(() {
      _inflightReconcile = null;
    });
    _inflightReconcile = task;
    return task;
  }

  Future<int?> _reconcileInner(String pubkey, {double? satsPerUsd}) async {
    final payments = await _tracker.fetchAiPayments(pubkey);
    if (payments.isEmpty) return 0;

    final credited = await _creditedHashes();
    var granted = 0;
    final newKeys = <String>{};
    for (final p in payments) {
      // Idempotency on a STABLE key (hash → bolt11 → amount+time fallback).
      // The old code skipped payments with an empty hash WITHOUT crediting
      // them — a settled top-up whose list row lacked payment_hash was lost
      // forever (paid, never credited, never recorded).
      final key = p.idempotencyKey;
      if (credited.contains(key)) continue;
      granted += _satsToTokens(p.amountSats, satsPerUsd);
      newKeys.add(key);
    }
    if (newKeys.isEmpty) return 0;
    // Credit FIRST, then record the keys — if the credit save fails we
    // still owe the user, and an unrecorded key is safe (a re-grant is
    // corrected by the next successful save) whereas a recorded key with
    // no credit loses paid sats forever.
    final ledger = await load();
    await save(ledger.credit(granted));
    await _saveCreditedHashes(credited..addAll(newKeys));
    return granted;
  }

  /// Records a just-paid invoice hash so reconcile() skips it. Stored with
  /// the same `hash:` prefix [AiPaymentRecord.idempotencyKey] uses — an
  /// unprefixed write here would never match a reconcile lookup.
  Future<void> markCredited(String paymentHash) async {
    if (paymentHash.isEmpty) return;
    final credited = await _creditedHashes();
    credited.add('hash:$paymentHash');
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
      if (json is! Map<String, dynamic>) return const AiCreditsLedger();
      final ledger = AiCreditsLedger.fromJson(json);
      // One-time sats → tokens migration. A legacy ledger has no marker;
      // the flag records that THIS store is already token-denominated.
      final migrated = await _storage.read(key: _migratedToTokensKey);
      if (migrated == '1') return ledger;
      final converted = _satsLedgerToTokens(ledger);
      await save(converted);
      await _storage.write(key: _migratedToTokensKey, value: '1');
      return converted;
    } catch (_) {
      // Corrupted store → zeroed ledger (checksum guard also covers this).
    }
    return const AiCreditsLedger();
  }

  /// Converts a legacy SATS ledger to tokens, preserving its dollar value.
  /// A zeroed ledger converts to itself (nothing to preserve).
  static AiCreditsLedger _satsLedgerToTokens(AiCreditsLedger ledger) {
    if (ledger.totalPurchased == 0 && ledger.totalSpent == 0) return ledger;
    int toTokens(int sats) => _satsToTokens(sats, migrationSatsPerUsd);
    return AiCreditsLedger(
      balance: toTokens(ledger.balance),
      totalPurchased: toTokens(ledger.totalPurchased),
      totalSpent: toTokens(ledger.totalSpent),
      updatedAt: ledger.updatedAt,
    );
  }

  /// Sats → tokens at [rate] (the live one when provided, else the migration
  /// constant). 1,000 tokens per $1 — sats × (tokensPerUsd / satsPerUsd).
  static int _satsToTokens(int sats, double? satsPerUsd) {
    final rate = (satsPerUsd != null && satsPerUsd > 0)
        ? satsPerUsd
        : migrationSatsPerUsd;
    return (sats * tokensPerUsd / rate).round();
  }

  Future<void> save(AiCreditsLedger ledger) {
    return _storage.write(key: _storageKey, value: jsonEncode(ledger.toJson()));
  }
}
