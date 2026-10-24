import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnbits_service.dart';

/// One top-up the house wallet actually received, attributed to a buyer.
class AiPaymentRecord {
  final String paymentHash;
  final int amountSats;
  final String memo;
  final int? timestamp;

  /// The invoice's bolt11 — the idempotency fallback when LNbits returns a
  /// settled payment WITHOUT a payment hash (some versions omit it on list
  /// endpoints). Also unique per invoice.
  final String? bolt11;

  const AiPaymentRecord({
    required this.paymentHash,
    required this.amountSats,
    required this.memo,
    this.timestamp,
    this.bolt11,
  });

  /// The idempotency key for reconciliation. A settled incoming payment must
  /// NEVER be skipped for lacking a hash — falling back to bolt11, then to
  /// amount+time, keeps exactly-once crediting even on LNbits builds whose
  /// list endpoint drops the hash field.
  String get idempotencyKey {
    if (paymentHash.isNotEmpty) return 'hash:$paymentHash';
    final invoice = bolt11;
    if (invoice != null && invoice.isNotEmpty) return 'bolt11:$invoice';
    return 'amount:$amountSats:${timestamp ?? 0}:$memo';
  }
}

/// Per-user AI payment tracking — the piece the per-device ledger can't do.
///
/// The house wallet's payment history IS the per-user record: every top-up
/// memo carries the buyer's pubkey (`NostrFeed AI credits {pack} · {pubkey12}`).
/// The invoice key can READ that history (never spend), so the app can answer
/// "did THIS user pay, and how much, ever" — across devices, and after a wipe.
///
/// Filtering is CLIENT-SIDE: LNbits's server-side `memo` query param is not
/// a guaranteed substring match across versions (and silently returns nothing
/// on some), which was the "paid, reconcile sees nothing, credits stay 0"
/// bug. We page the wallet's payments and match memos ourselves.
class AiPaymentTracker {
  AiPaymentTracker({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  static const _timeout = Duration(seconds: 15);

  /// Total sats THIS user has ever topped up, from the house wallet's own
  /// history — the authoritative number, not a local record.
  ///
  /// Returns null when the house wallet is not configured or the query
  /// fails (the caller treats null as "don't know", never as zero — showing
  /// zero for a payer who is just offline would zero their credits).
  Future<int?> totalTopUpSats(String pubkey) async {
    if (!HouseWallet.isConfigured || pubkey.isEmpty) return null;
    try {
      final payments = await fetchAiPayments(pubkey);
      var total = 0;
      for (final p in payments) {
        total += p.amountSats;
      }
      return total;
    } catch (_) {
      return null;
    }
  }

  /// Every settled AI top-up by this user, newest first. Used by the
  /// reconcile flow to grant credits for payments made on OTHER devices.
  Future<List<AiPaymentRecord>> fetchAiPayments(String pubkey) async {
    // The OPERATOR instance, always — the HouseWallet keys only exist
    // there, and every other operator-bound service (nostrnip5, lnurlp,
    // bunker, wallet tools) also pins `Env.lnbitsUrl`. The Settings URL
    // override is for whole-deployment self-hosting; following the
    // user-level override here would split the AI credits wallet off
    // from the rest of the stack and invoices/reconcile would drift.
    final base = Env.lnbitsUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$base/api/v1/payments').replace(
      queryParameters: {
        'limit': '200',
        'sortby': 'time',
        'direction': 'desc',
      },
    );
    final res = await _client
        .get(uri, headers: {'X-API-KEY': HouseWallet.invoiceKey})
        .timeout(_timeout);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return const [];
    }
    final list = jsonDecode(res.body);
    if (list is! List) return const [];

    final out = <AiPaymentRecord>[];
    for (final raw in list) {
      if (raw is! Map<String, dynamic>) continue;
      // Only SETTLED incoming payments credit anything. A pending or failed
      // invoice is not money received (LNbits marks them status 'pending' /
      // 'failed' and negative amounts are outgoing spends).
      final status = raw['status'];
      if (status is String && status != 'success') continue;
      if (raw['pending'] == true) continue;
      final amount = raw['amount'];
      if (amount is! num || amount <= 0) continue;
      final memo = sanitizeTextOrNull(raw['memo'] as String?) ?? '';
      // Only AI-credit top-ups by THIS user.
      if (!isAiCreditMemo(memo, pubkey)) continue;
      final sats = (amount / 1000).round();
      if (sats <= 0) continue;
      out.add(AiPaymentRecord(
        paymentHash: raw['payment_hash'] as String? ?? '',
        amountSats: sats,
        memo: memo,
        timestamp: _readTime(raw),
        bolt11: raw['bolt11'] as String?,
      ));
    }
    return out;
  }

  /// Whether a memo is an AI-credit top-up by [pubkey]. Public + static so
  /// the top-up flow and the tests pin the exact same matcher — a memo
  /// that fails this check is a payment reconciliation can never recover.
  static bool isAiCreditMemo(String memo, String pubkey) {
    if (!memo.toLowerCase().contains('ai credits') &&
        !memo.toLowerCase().contains('ai-credits')) {
      return false;
    }
    final short = pubkey.length > 12 ? pubkey.substring(0, 12) : pubkey;
    return memo.contains(short) || memo.contains(pubkey);
  }

  int? _readTime(Map<String, dynamic> raw) {
    final t = raw['time'];
    if (t is num) return t > 1e11 ? (t / 1000).round() : t.toInt();
    if (t is String) {
      final parsed = DateTime.tryParse(t);
      if (parsed != null) return parsed.millisecondsSinceEpoch ~/ 1000;
    }
    return null;
  }
}
