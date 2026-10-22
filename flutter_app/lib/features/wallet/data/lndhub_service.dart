import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

/// Credentials for an LndHub account, parsed from a scanned QR / pasted URI.
///
/// The `lndhub://` URI scheme is what BlueWallet, Zeus, Alby, Umbrel and
/// BTCPay Server show as a "connect wallet" QR:
///
/// ```
/// lndhub://<login>:<password>@<host:port>
/// ```
///
/// Login and password are NOT an admin key — they mint a short-lived OAuth
/// access token via `POST /auth`, and the token is what signs calls.
class LndHubCredentials {
  final String login;
  final String password;

  /// Base URL of the hub, no trailing slash (e.g. `https://hub.example:3000`).
  final String host;

  const LndHubCredentials({
    required this.login,
    required this.password,
    required this.host,
  });

  /// Parse an `lndhub://` URI (or a bare `login:password@host` string).
  /// Returns null when the shape is not an LndHub credential — the caller
  /// decides what else the string might be (a NWC URI, an invoice…).
  static LndHubCredentials? parse(String input) {
    var s = input.trim();
    if (s.isEmpty) return null;
    if (s.toLowerCase().startsWith('lndhub://')) {
      s = s.substring('lndhub://'.length);
    } else if (!s.contains('@')) {
      return null;
    }

    // Strip any path (some exports append one).
    final at = s.lastIndexOf('@');
    if (at <= 0) return null;
    final creds = s.substring(0, at);
    var host = s.substring(at + 1);
    final colon = creds.indexOf(':');
    if (colon <= 0) return null;

    final login = Uri.decodeComponent(creds.substring(0, colon));
    final password = Uri.decodeComponent(creds.substring(colon + 1));
    if (login.isEmpty || password.isEmpty) return null;

    if (!host.startsWith('http://') && !host.startsWith('https://')) {
      host = 'https://$host';
    }
    host = host.replaceAll(RegExp(r'/+$'), '');

    return LndHubCredentials(login: login, password: password, host: host);
  }

  /// Back to URI form (for display, never for logging secrets).
  String toUri() =>
      'lndhub://${Uri.encodeComponent(login)}:${Uri.encodeComponent(password)}@$host';
}

/// An LndHub account as a spendable wallet: OAuth token from login/password,
/// then balance / invoices / payments against the hub.
///
/// API (BlueWallet LndHub + BTCPay-compatible):
/// - `POST /auth` → `{access_token, refresh_token}`
/// - `GET  /getbalance` → `{BTC: {AvailableBalance, TotalBalance, …}}`
/// - `POST /payinvoice` `{invoice}` → pays a bolt11
/// - `POST /addinvoice` `{amt, memo}` → `{pay_req, payment_hash}` (receive)
/// - `GET  /gettxs` → transaction list
class LndHubService {
  final LndHubCredentials credentials;
  String? _accessToken;
  String? _refreshToken;

  LndHubService(this.credentials);

  bool get isAuthorized => _accessToken != null;

  Future<dynamic> _request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('${credentials.host}$path');
    final headers = <String, String>{
      if (body != null) 'Content-Type': 'application/json',
      if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
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

    if (response.statusCode == 401 && _refreshToken != null) {
      // Token expired mid-flight — refresh once and retry once.
      await _refresh();
      return _request(path, method: method, body: body);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw LndHubException(_describeError(parsed, response.statusCode));
    }
    return parsed;
  }

  String _describeError(dynamic body, int status) {
    if (body is Map) {
      final err = body['error'] ?? body['message'];
      if (err is String && err.isNotEmpty) return sanitizeText(err);
    }
    if (body is String && body.trim().isNotEmpty) return sanitizeText(body);
    return 'LndHub request failed ($status)';
  }

  /// Login (or refresh) — exchanges login/password for an access token.
  Future<void> authorize() async {
    final body = await _authRequest({
      'login': credentials.login,
      'password': credentials.password,
    });
    _readTokens(body);
  }

  Future<void> _refresh() async {
    final body = await _authRequest({
      'refresh_token': _refreshToken,
      'grant_type': 'refresh_token',
    });
    _readTokens(body);
  }

  Future<dynamic> _authRequest(Map<String, dynamic> payload) async {
    final response = await http
        .post(
          Uri.parse('${credentials.host}/auth?type=auth'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 15));
    final text = response.body;
    dynamic parsed;
    try {
      parsed = text.isNotEmpty ? jsonDecode(text) : null;
    } catch (_) {
      parsed = text;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw LndHubException(_describeError(parsed, response.statusCode));
    }
    return parsed;
  }

  void _readTokens(dynamic body) {
    if (body is! Map) {
      throw const LndHubException('The hub returned no token');
    }
    final access = body['access_token'];
    if (access is! String || access.isEmpty) {
      throw const LndHubException('The hub returned no access token');
    }
    _accessToken = access;
    final refresh = body['refresh_token'];
    if (refresh is String && refresh.isNotEmpty) _refreshToken = refresh;
  }

  /// Spendable balance in sats (AvailableBalance).
  Future<int> getBalanceSats() async {
    final body = await _request('/getbalance');
    if (body is Map && body['BTC'] is Map) {
      final btc = body['BTC'] as Map;
      final available = btc['AvailableBalance'] ?? btc['TotalBalance'];
      if (available is num) return available.toInt();
    }
    return 0;
  }

  /// Pay a bolt11 invoice.
  Future<void> payInvoice(String bolt11) async {
    await _request('/payinvoice', method: 'POST', body: {'invoice': bolt11});
  }

  /// Create an invoice (receive). Returns (bolt11, payment_hash).
  Future<({String bolt11, String paymentHash})> addInvoice({
    required int amountSats,
    String? memo,
  }) async {
    final body = await _request('/addinvoice', method: 'POST', body: {
      'amt': '$amountSats',
      if (memo != null && memo.isNotEmpty) 'memo': memo,
    });
    if (body is Map) {
      final bolt11 = body['pay_req'] ?? body['payment_request'];
      final hash = body['payment_hash'] ?? body['r_hash'] ?? '';
      if (bolt11 is String && bolt11.isNotEmpty) {
        return (bolt11: bolt11, paymentHash: '$hash');
      }
    }
    throw const LndHubException('The hub returned no invoice');
  }

  /// Whether an invoice was paid (via /getuserinvoices).
  Future<bool> isInvoicePaid(String paymentHash) async {
    try {
      final body = await _request('/getuserinvoices');
      if (body is List) {
        for (final inv in body) {
          if (inv is Map &&
              '${inv['payment_hash'] ?? inv['r_hash']}' == paymentHash) {
            return inv['ispaid'] == true || inv['paid'] == true;
          }
        }
      }
    } catch (_) {}
    return false;
  }

  /// Recent transactions, normalized to a small display shape.
  Future<List<LndHubTx>> getTransactions({int limit = 20}) async {
    final body = await _request('/gettxs?limit=$limit');
    final txs = <LndHubTx>[];
    if (body is List) {
      for (final raw in body) {
        if (raw is! Map) continue;
        txs.add(LndHubTx.fromJson(raw.cast<String, dynamic>()));
      }
    }
    return txs;
  }
}

/// A transaction on an LndHub account, normalized for display.
class LndHubTx {
  final int amountSats;
  final bool isIncoming;
  final String? memo;
  final int? timestamp;

  const LndHubTx({
    required this.amountSats,
    required this.isIncoming,
    this.memo,
    this.timestamp,
  });

  factory LndHubTx.fromJson(Map<String, dynamic> json) {
    final amt = (json['amt'] ?? json['value'] ?? 0);
    final amount = amt is num ? amt.toInt() : (int.tryParse('$amt') ?? 0);
    final type = '${json['type'] ?? ''}';
    // LndHub marks outgoing payments type 'paid_invoice'; incoming have a
    // positive amt or an ispaid flag on invoices.
    final incoming = json.containsKey('ispaid') ||
        type == 'user_invoice' ||
        (json['payment_preimage'] == null && amount > 0);
    return LndHubTx(
      amountSats: amount.abs(),
      isIncoming: incoming,
      memo: sanitizeTextOrNull(json['memo'] as String?),
      timestamp: json['timestamp'] is num
          ? (json['timestamp'] as num).toInt()
          : (json['time'] is num ? (json['time'] as num).toInt() : null),
    );
  }
}

class LndHubException implements Exception {
  final String message;
  const LndHubException(this.message);

  @override
  String toString() => sanitizeText(message);
}
