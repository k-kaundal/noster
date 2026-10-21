import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

/// Core LNbits wallet tools that are NOT extensions — decode, pay-lnurl,
/// fiat rate, and recheck-pending. These are `/api/v1/...` core routes plus
/// the `/api/v1/extension/{id}` availability probe used to gate the optional
/// extensions (bunker, NWC provider, auction house, nostrrelay…).
class WalletToolsException implements Exception {
  final String message;
  const WalletToolsException(this.message);
  @override
  String toString() => sanitizeText(message);
}

/// What a pasted payment target decodes to, per `POST /api/v1/payments/decode`.
class DecodedPayment {
  final String? bolt11;
  final int? amountSats;
  final String? description;
  final String? destination;
  final String? paymentHash;
  final int? expirySeconds;

  const DecodedPayment({
    this.bolt11,
    this.amountSats,
    this.description,
    this.destination,
    this.paymentHash,
    this.expirySeconds,
  });
}

class WalletToolsService {
  WalletToolsService({String? baseUrl})
      : baseUrl = baseUrl ?? Env.lnbitsUrl.replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

  // ── Extension availability ───────────────────────────────────────────

  /// Whether an optional extension is INSTALLED on the server (not merely
  /// enabled for one account). `GET /api/v1/extension/all` lists installed
  /// extensions; a feature probes once and gates its UI on the answer so it
  /// never offers something that 404s.
  ///
  /// Returns true/false, or null when the probe itself failed (offline,
  /// unauthorised) — the caller treats null as "don't hide, but don't crash".
  Future<bool?> isExtensionInstalled(String extId, {String? token}) async {
    try {
      final json = await _request<dynamic>(
        '/api/v1/extension/all',
        token: token,
        parser: (json) => json,
      );
      if (json is List) {
        for (final e in json) {
          if (e is Map && e['code'] == extId) return true;
        }
        return false;
      }
      // A map keyed by ext id on some versions.
      if (json is Map) return json.containsKey(extId);
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Turns an extension on for the signed-in account. Best-effort: the web's
  /// `enableExtension`. Needs the session token.
  Future<void> enableExtension(String extId, {String? token}) async {
    await _request<dynamic>(
      '/api/v1/extension/$extId/enable',
      method: 'PUT',
      token: token,
      parser: (json) => json,
    );
  }

  // ── Payments decode / pay-lnurl / recheck ────────────────────────────

  /// Decode any payment target (bolt11, LNURL, or lightning address) before
  /// paying — `POST /api/v1/payments/decode`. Shows amount + destination +
  /// expiry so the user confirms what they're about to spend.
  Future<DecodedPayment> decodePayment(String data, {String? apiKey}) async {
    final json = await _request<dynamic>(
      '/api/v1/payments/decode',
      method: 'POST',
      apiKey: apiKey,
      body: {'data': data},
      parser: (json) => json,
    );
    final map = json is Map ? json : const <String, dynamic>{};
    // LNbits returns a list of [domain, ...] for LNURL, or a Payment object
    // for bolt11. Read both shapes defensively.
    final payment = map['payment'] is Map
        ? map['payment'] as Map
        : map;
    final amountMsat = payment['amount_msat'] ?? payment['amount'];
    return DecodedPayment(
      bolt11: payment['bolt11'] as String? ??
          payment['payment_request'] as String?,
      amountSats: amountMsat is num ? (amountMsat / 1000).round() : null,
      description: sanitizeTextOrNull(
          payment['description'] as String? ?? payment['memo'] as String?),
      destination: sanitizeTextOrNull(
          payment['destination'] as String? ?? payment['domain'] as String?),
      paymentHash: payment['payment_hash'] as String?,
      expirySeconds: payment['expiry'] is num
          ? (payment['expiry'] as num).toInt()
          : null,
    );
  }

  /// Pay an LNURL payment request server-side (handles payerData + nostr
  /// zaps properly). `POST /api/v1/payments/lnurl`.
  Future<void> payLnurl({
    required String apiKey,
    required int amountSats,
    String? lnurl,
    String? comment,
    Map<String, dynamic>? payResponse,
  }) async {
    await _request<dynamic>(
      '/api/v1/payments/lnurl',
      method: 'POST',
      apiKey: apiKey,
      body: {
        'amount': amountSats,
        'lnurl': ?lnurl,
        'res': ?payResponse,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
      },
      parser: (json) => json,
    );
  }

  /// Force a re-check of pending payments — `GET /api/v1/payments/paginated`
  /// with `recheck_pending=true`. The "invoice stuck pending" fix, better
  /// than blind polling.
  Future<void> recheckPending({String? apiKey}) async {
    await _request<dynamic>(
      '/api/v1/payments/paginated?recheck_pending=true&limit=1',
      apiKey: apiKey,
      parser: (json) => json,
    );
  }

  // ── Fiat rate ────────────────────────────────────────────────────────

  /// The fiat rate for one currency, `GET /api/v1/rate/{currency}` → a map
  /// of provider→rate; the median is the usable "sats⇄fiat" figure.
  Future<double?> fiatRate(String currency) async {
    try {
      final json = await _request<dynamic>(
        '/api/v1/rate/${Uri.encodeComponent(currency.toUpperCase())}',
        parser: (json) => json,
      );
      if (json is Map) {
        final rates = <double>[];
        for (final v in json.values) {
          if (v is num && v > 0) rates.add(v.toDouble());
        }
        if (rates.isEmpty) return null;
        rates.sort();
        return rates[rates.length ~/ 2];
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Rough sats→fiat, for "≈ $X" next to amounts. Null when no rate.
  Future<String?> describeSatsAsFiat(int sats, String currency) async {
    final rate = await fiatRate(currency);
    if (rate == null) return null;
    final fiat = sats / 100000000 * rate;
    final c = currency.toUpperCase();
    final symbol = switch (c) {
      'USD' => '\$',
      'EUR' => '€',
      'GBP' => '£',
      _ => '',
    };
    final formatted = fiat >= 1
        ? fiat.toStringAsFixed(2)
        : fiat.toStringAsFixed(4);
    return symbol.isNotEmpty ? '≈ $symbol$formatted' : '≈ $formatted $c';
  }

  // ── Low-level request ────────────────────────────────────────────────

  Future<T> _request<T>(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
    String? apiKey,
    String? token,
    required T Function(dynamic) parser,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      if (body != null) 'Content-Type': 'application/json',
      'X-API-KEY': ?apiKey,
      if (token != null) 'Authorization': 'Bearer $token',
    };

    final request = http.Request(method, uri);
    request.headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);

    final streamed = await request.send().timeout(const Duration(seconds: 15));
    final response = await http.Response.fromStream(streamed);
    final text = response.body;

    dynamic parsed;
    if (text.isNotEmpty) {
      try {
        parsed = jsonDecode(text);
      } catch (_) {
        parsed = text;
      }
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      String message;
      if (parsed is String && parsed.isNotEmpty) {
        message = parsed;
      } else if (parsed is Map<String, dynamic>) {
        final detail = parsed['detail'];
        if (detail is String) {
          message = detail;
        } else if (detail is List) {
          message = detail
              .map((e) => e is Map ? (e['msg'] as String? ?? '') : '')
              .where((s) => s.isNotEmpty)
              .join('; ');
        } else {
          message = 'Request failed (${response.statusCode})';
        }
      } else {
        message = 'Request failed (${response.statusCode})';
      }
      throw WalletToolsException(message);
    }

    return parser(parsed);
  }
}
