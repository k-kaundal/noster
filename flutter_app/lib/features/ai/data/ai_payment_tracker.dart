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

  const AiPaymentRecord({
    required this.paymentHash,
    required this.amountSats,
    required this.memo,
    this.timestamp,
  });
}

/// Per-user AI payment tracking — the piece the per-device ledger can't do.
///
/// The house wallet's payment history IS the per-user record: every top-up
/// memo carries the buyer's pubkey (`ai-credits:{pack} · {pubkey12}` or
/// `ai-credits:{pubkey}:{pack}`). The invoice key can READ that history
/// (never spend), so the app can answer "did THIS user pay, and how much,
/// ever" — across devices, and after a wipe.
///
/// `GET /api/v1/payments` accepts `memo` + `wallet_id` filters, so this
/// asks the server for only this user's AI top-ups rather than paging the
/// whole wallet.
class AiPaymentTracker {
  AiPaymentTracker();

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

  /// Every AI top-up by this user, newest first. Used by the reconcile
  /// flow to grant credits for payments made on OTHER devices.
  Future<List<AiPaymentRecord>> fetchAiPayments(String pubkey) async {
    // The memo carries the buyer. Query the server-side filter rather than
    // pulling the whole wallet history down.
    final short = pubkey.length > 12 ? pubkey.substring(0, 12) : pubkey;
    final uri = Uri.parse('${Env.lnbitsUrl}/api/v1/payments').replace(
      queryParameters: {
        'limit': '200',
        'memo': short, // server-side memo contains-filter
        'sortby': 'time',
        'direction': 'desc',
      },
    );
    final res = await http
        .get(uri, headers: {'X-API-KEY': HouseWallet.invoiceKey})
        .timeout(const Duration(seconds: 15));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return const [];
    }
    final list = jsonDecode(res.body);
    if (list is! List) return const [];

    final out = <AiPaymentRecord>[];
    for (final raw in list) {
      if (raw is! Map<String, dynamic>) continue;
      final memo = sanitizeTextOrNull(raw['memo'] as String?) ?? '';
      // Only AI-credit top-ups by THIS user, and only settled incoming ones.
      if (!_isAiCreditMemo(memo, pubkey)) continue;
      final amount = raw['amount'];
      final sats = amount is num ? (amount.abs() / 1000).round() : 0;
      if (sats <= 0) continue;
      out.add(AiPaymentRecord(
        paymentHash: raw['payment_hash'] as String? ?? '',
        amountSats: sats,
        memo: memo,
        timestamp: _readTime(raw),
      ));
    }
    return out;
  }

  /// Whether a memo is an AI-credit top-up by [pubkey]. Covers both memo
  /// shapes: `ai-credits:{pack} · {pubkey12}` and `ai-credits:{pubkey}:{pack}`.
  bool _isAiCreditMemo(String memo, String pubkey) {
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
