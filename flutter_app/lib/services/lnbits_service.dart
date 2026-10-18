import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/env.dart';
import '../models/nostr_models.dart';
import 'auth_service.dart';

/// Base URL of the LNbits instance this app talks to.
String get lnbitsUrl => Env.lnbitsUrl.replaceAll(RegExp(r'/+$'), '');

/// House wallet: a receive-only shared wallet the app can issue invoices on.
/// The invoice key ships in the bundle; it can only read balance + create
/// invoices. No spending is possible with it.
class HouseWallet {
  static String get id => Env.lnbitsWalletId;
  static String get invoiceKey => Env.lnbitsInvoiceKey;
  static bool get isConfigured => invoiceKey.isNotEmpty;
}

/// An LNbits wallet as returned by `/api/v1/wallets`.
class LnbitsWallet {
  final String id;
  final String name;
  final int balanceMsat;
  /// Spends. Never persist this beyond session storage.
  final String? adminkey;
  /// Creates invoices and reads balance.
  final String? inkey;
  final String? userId;

  const LnbitsWallet({
    required this.id,
    required this.name,
    required this.balanceMsat,
    this.adminkey,
    this.inkey,
    this.userId,
  });

  int get balanceSats => balanceMsat ~/ 1000;

  factory LnbitsWallet.fromJson(Map<String, dynamic> json) => LnbitsWallet(
        id: json['id'] as String,
        name: json['name'] as String? ?? 'Wallet',
        balanceMsat: _readBalanceMsat(json),
        adminkey: json['adminkey'] as String?,
        inkey: json['inkey'] as String?,
        userId: json['user'] as String?,
      );

  static int _readBalanceMsat(Map<String, dynamic> json) {
    for (final key in ['balance_msat', 'balance']) {
      final value = json[key];
      if (value is num) return value.toInt();
    }
    return 0;
  }
}

/// A payment on an LNbits wallet.
class LnbitsPayment {
  final String checkingId;
  final String paymentHash;
  final String walletId;
  /// Millisatoshis. Negative for outgoing.
  final int amount;
  final int fee;
  final String? bolt11;
  final String status; // pending | success | failed
  final String? memo;
  final String? preimage;
  final int? timestampMs; // normalised ms since epoch
  final String? tag;
  final String? extension;

  const LnbitsPayment({
    required this.checkingId,
    required this.paymentHash,
    required this.walletId,
    required this.amount,
    this.fee = 0,
    this.bolt11,
    required this.status,
    this.memo,
    this.preimage,
    this.timestampMs,
    this.tag,
    this.extension,
  });

  bool get isIncoming => amount >= 0;
  bool get isPending => status == 'pending';
  bool get isSuccess => status == 'success';
  int get amountSats => (amount.abs()) ~/ 1000;

  factory LnbitsPayment.fromJson(Map<String, dynamic> json) {
    final rawTime = json['time'];
    int? ts;
    if (rawTime is num) {
      ts = rawTime > 1e11 ? rawTime.toInt() : (rawTime * 1000).toInt();
    } else if (rawTime is String) {
      ts = DateTime.tryParse(rawTime)?.millisecondsSinceEpoch;
    }
    return LnbitsPayment(
      checkingId: json['checking_id'] as String? ?? '',
      paymentHash: json['payment_hash'] as String? ?? '',
      walletId: json['wallet_id'] as String? ?? '',
      amount: (json['amount'] as num?)?.toInt() ?? 0,
      fee: (json['fee'] as num?)?.toInt() ?? 0,
      bolt11: json['bolt11'] as String?,
      status: json['status'] as String? ?? 'pending',
      memo: json['memo'] as String?,
      preimage: json['preimage'] as String?,
      timestampMs: ts,
      tag: json['tag'] as String?,
      extension: json['extension'] as String?,
    );
  }
}

/// LNbits account as returned by `/api/v1/auth`.
class LnbitsUser {
  final String id;
  final String? username;
  final String? pubkey;
  final String? email;
  final List<LnbitsWallet> wallets;
  final bool admin;
  final bool superUser;
  final bool hasPassword;
  final Map<String, dynamic>? extra;

  const LnbitsUser({
    required this.id,
    this.username,
    this.pubkey,
    this.email,
    this.wallets = const [],
    this.admin = false,
    this.superUser = false,
    this.hasPassword = false,
    this.extra,
  });

  factory LnbitsUser.fromJson(Map<String, dynamic> json) => LnbitsUser(
        id: json['id'] as String,
        username: json['username'] as String?,
        pubkey: json['pubkey'] as String?,
        email: json['email'] as String?,
        wallets: ((json['wallets'] as List?) ?? [])
            .whereType<Map<String, dynamic>>()
            .map(LnbitsWallet.fromJson)
            .toList(),
        admin: json['admin'] as bool? ?? false,
        superUser: json['super_user'] as bool? ?? false,
        hasPassword: json['has_password'] as bool? ?? false,
        extra: json['extra'] as Map<String, dynamic>?,
      );
}

/// Error thrown by LNbits calls.
class LnbitsException implements Exception {
  final String message;
  final int status;
  final dynamic body;

  const LnbitsException(this.message, this.status, [this.body]);

  @override
  String toString() => message;
}

/// Full LNbits REST client matching the web app's `lib/lnbits.ts`.
class LnbitsService {
  LnbitsService({String? baseUrl}) : baseUrl = baseUrl ?? lnbitsUrl;

  final String baseUrl;

  // ── Low-level request ──────────────────────────────────────────────

  /// One request to LNbits. Sends credentials so session cookies are included.
  Future<dynamic> _request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
    String? apiKey,
    String? token,
    Duration timeout = const Duration(seconds: 15),
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      if (body != null) 'Content-Type': 'application/json',
      if (apiKey != null) 'X-API-KEY': apiKey,
      if (token != null) 'Authorization': 'Bearer $token',
    };

    final request = http.Request(method, uri);
    request.headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);

    final streamed = await request.send().timeout(timeout);
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
      throw LnbitsException(
        _describeError(parsed, response.statusCode),
        response.statusCode,
        parsed,
      );
    }
    return parsed;
  }

  String _describeError(dynamic body, int status) {
    if (body is String && body.trim().isNotEmpty) return body;
    if (body is Map<String, dynamic>) {
      final message = body['message'];
      if (message is String && message.isNotEmpty) return message;
      final detail = body['detail'];
      if (detail is String && detail.isNotEmpty) return detail;
      if (detail is List) {
        final msgs = detail
            .map((e) =>
                e is Map ? (e['msg'] as String? ?? '') : '')
            .where((s) => s.isNotEmpty)
            .toList();
        if (msgs.isNotEmpty) return msgs.join('; ');
      }
    }
    if (status == 401) return 'Not authorised — sign in again.';
    if (status == 402) return 'Insufficient balance.';
    if (status == 520) return 'The Lightning node rejected the payment.';
    return 'Request failed ($status)';
  }

  // ── Auth: login flows ─────────────────────────────────────────────

  /// Pull the access token out of a login response, whatever shape it takes.
  String? _readAccessToken(dynamic body) {
    if (body is! Map) return null;
    final record = body as Map<String, dynamic>;
    for (final key in ['access_token', 'token', 'accessToken']) {
      final value = record[key];
      if (value is String && value.isNotEmpty) return value;
    }
    return null;
  }

  /// NIP-98 signed Nostr login. Returns the session token.
  ///
  /// LNbits accepts a kind-27235 Nostr event in the `Authorization` header.
  /// It checks the `u` tag against its `nostr_absolute_request_urls` setting,
  /// which usually ships as a bare origin, so both `…/nostr` and the endpoint
  /// are tried.
  Future<String?> loginWithNostr(AuthService authService) async {
    final endpoint = '$baseUrl/api/v1/auth/nostr';
    final candidates = ['$baseUrl/nostr', endpoint];

    LnbitsException? lastError;
    for (final signedUrl in candidates) {
      try {
        return await _postNostrLogin(authService, endpoint, signedUrl);
      } on LnbitsException catch (e) {
        if (!_isUrlTagRejection(e)) rethrow;
        lastError = e;
      }
    }
    if (lastError != null) throw lastError;
    return null;
  }

  Future<String?> _postNostrLogin(
    AuthService authService,
    String endpoint,
    String signedUrl,
  ) async {
    final authHeader = await _nip98Header(authService, signedUrl, 'POST');

    final response = await http
        .post(
          Uri.parse(endpoint),
          headers: {'Authorization': authHeader},
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
      throw LnbitsException(
        _describeError(parsed, response.statusCode),
        response.statusCode,
        parsed,
      );
    }

    return _readAccessToken(parsed);
  }

  bool _isUrlTagRejection(LnbitsException e) =>
      RegExp(r"tag 'u'", caseSensitive: false).hasMatch(e.message);

  /// Builds the NIP-98 `Authorization` header for a request.
  ///
  /// The signed event is kind 27235 with `u` and `method` tags. LNbits
  /// validates the `u` tag against its `nostr_absolute_request_urls` setting.
  Future<String> _nip98Header(
    AuthService authService,
    String url,
    String method,
  ) async {
    // This method is a placeholder - use nip98HeaderWithSigner instead
    throw UnimplementedError(
        'Use nip98HeaderWithSigner instead — it takes the signed event.');
  }

  /// Sign and build the NIP-98 header using an explicit signer callback.
  ///
  /// [signEvent] is called with the event fields (kind, tags, content) and
  /// must return the full signed Nostr event JSON.
  Future<String> nip98HeaderWithSigner({
    required String url,
    required String method,
    required Future<NostrEvent> Function({
      required int kind,
      required String content,
      required List<List<String>> tags,
    })
        signEvent,
    Map<String, dynamic>? payload,
  }) async {
    final tags = <List<String>>[
      ['u', url],
      ['method', method],
    ];
    if (payload != null) {
      tags.add(
          ['payload', base64Encode(utf8.encode(jsonEncode(payload)))]);
    }

    final event = await signEvent(
      kind: 27235,
      content: '',
      tags: tags,
    );

    final eventJson = jsonEncode(event.toJson());
    return 'Nostr ${base64Encode(utf8.encode(eventJson))}';
  }

  /// Login with a Nostr key, given an explicit signer.
  ///
  /// The Flutter app does not have a JS-style `NostrSigner` interface, so the
  /// signer is passed in as a callback from the auth provider.
  Future<String?> loginWithNostrSigned(
    Future<NostrEvent> Function({
      required int kind,
      required String content,
      required List<List<String>> tags,
    })
        signEvent,
  ) async {
    final endpoint = '$baseUrl/api/v1/auth/nostr';
    final candidates = ['$baseUrl/nostr', endpoint];

    LnbitsException? lastError;
    for (final signedUrl in candidates) {
      try {
        final header = await nip98HeaderWithSigner(
          url: signedUrl,
          method: 'POST',
          signEvent: signEvent,
        );

        final response = await http
            .post(
              Uri.parse(endpoint),
              headers: {'Authorization': header},
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
          throw LnbitsException(
            _describeError(parsed, response.statusCode),
            response.statusCode,
            parsed,
          );
        }

        return _readAccessToken(parsed);
      } on LnbitsException catch (e) {
        if (!_isUrlTagRejection(e)) rethrow;
        lastError = e;
      }
    }
    if (lastError != null) throw lastError;
    return null;
  }

  /// Login with username + password. Returns the session token.
  Future<String?> loginWithPassword(
      String username, String password) async {
    final body = await _request('/api/v1/auth',
        method: 'POST',
        body: {'username': username, 'password': password});
    return _readAccessToken(body);
  }

  /// Login with the account id from a `?usr=` link. Requires `user-id-only`
  /// in the instance's `auth_allowed_methods`.
  Future<String?> loginWithUserId(String usr) async {
    final body = await _request('/api/v1/auth/usr',
        method: 'POST', body: {'usr': usr});
    return _readAccessToken(body);
  }

  /// Pull the account id out of whatever someone pasted.
  ///
  /// Accepts a full wallet URL or a bare UUID.
  static String? parseUserId(String input) {
    final trimmed = input.trim();
    if (trimmed.isEmpty) return null;

    final uuidPattern = RegExp(
        r'[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
        caseSensitive: false);

    // Try as URL
    try {
      final uri = Uri.parse(trimmed);
      final usr = uri.queryParameters['usr'];
      if (usr != null && uuidPattern.hasMatch(usr)) return usr;
    } catch (_) {}

    // Try as bare id
    final match = uuidPattern.firstMatch(trimmed);
    return match?.group(0);
  }

  /// Whether a failure means "nobody is signed in".
  static bool isMissingSession(Object error) {
    if (error is! LnbitsException) return false;
    if (error.status == 401 || error.status == 403) return true;
    return error.status == 400 &&
        RegExp(r'missing user id|access token|not authenticated',
                caseSensitive: false)
            .hasMatch(error.message);
  }

  /// Get the authenticated account.
  Future<LnbitsUser> getAccount(String token) async {
    final body = await _request('/api/v1/auth', token: token);
    return LnbitsUser.fromJson(body as Map<String, dynamic>);
  }

  /// Update account profile fields.
  Future<LnbitsUser> updateAccount({
    required String token,
    required String userId,
    String? username,
    Map<String, dynamic>? extra,
  }) async {
    final body = await _request(
      '/api/v1/auth',
      method: 'PATCH',
      token: token,
      body: {
        'user_id': userId,
        if (username != null) 'username': username,
        if (extra != null) 'extra': extra,
      },
    );
    return LnbitsUser.fromJson(body as Map<String, dynamic>);
  }

  /// Set or change the account password.
  Future<LnbitsUser> setPassword({
    required String token,
    required String userId,
    required String username,
    required String password,
    required String passwordRepeat,
    String? currentPassword,
  }) async {
    final body = await _request(
      '/api/v1/auth/password',
      method: 'PUT',
      token: token,
      body: {
        'user_id': userId,
        'username': username,
        'password': password,
        'password_repeat': passwordRepeat,
        if (currentPassword != null) 'password_old': currentPassword,
      },
    );
    return LnbitsUser.fromJson(body as Map<String, dynamic>);
  }

  /// Link the account to a different Nostr pubkey.
  Future<LnbitsUser> linkPubkey({
    required String token,
    required String userId,
    required String pubkey,
  }) async {
    final body = await _request(
      '/api/v1/auth/pubkey',
      method: 'PUT',
      token: token,
      body: {'user_id': userId, 'pubkey': pubkey},
    );
    return LnbitsUser.fromJson(body as Map<String, dynamic>);
  }

  /// Create the first wallet for a brand-new account.
  Future<LnbitsWallet> createWallet({
    required String token,
    String name = 'NostrFeed',
  }) async {
    final body = await _request(
      '/api/v1/wallet',
      method: 'POST',
      token: token,
      body: {'name': name, 'wallet_type': 'lightning'},
    );
    return LnbitsWallet.fromJson(body as Map<String, dynamic>);
  }

  // ── Wallet operations ─────────────────────────────────────────────

  /// Get a wallet's details (balance etc). Uses the wallet's invoice key.
  Future<LnbitsWallet> getWallet(String apiKey, String walletId) async {
    final body = await _request('/api/v1/wallet', apiKey: apiKey);
    final json = body as Map<String, dynamic>;
    return LnbitsWallet.fromJson({...json, 'id': walletId});
  }

  /// Get payments for a wallet.
  Future<List<LnbitsPayment>> getPayments(String apiKey,
      {int limit = 50}) async {
    final body = await _request('/api/v1/payments?limit=$limit',
        apiKey: apiKey);
    final list = body as List? ?? [];
    return list
        .whereType<Map<String, dynamic>>()
        .map(LnbitsPayment.fromJson)
        .toList();
  }

  /// Create an invoice (receive).
  Future<LnbitsInvoice> createInvoice({
    required String apiKey,
    required int amountSats,
    String? memo,
    int? expirySeconds,
  }) async {
    final body = await _request(
      '/api/v1/payments',
      method: 'POST',
      apiKey: apiKey,
      body: {
        'out': false,
        'amount': amountSats,
        'unit': 'sat',
        'memo': memo ?? '',
        if (expirySeconds != null) 'expiry': expirySeconds,
      },
    );
    final json = body as Map<String, dynamic>;
    return LnbitsInvoice(
      paymentHash: json['payment_hash'] as String? ?? '',
      bolt11: _readBolt11(json),
    );
  }

  /// Pay a BOLT11 invoice.
  Future<void> payInvoice({
    required String apiKey,
    required String bolt11,
  }) async {
    await _request(
      '/api/v1/payments',
      method: 'POST',
      apiKey: apiKey,
      body: {'out': true, 'bolt11': bolt11},
    );
  }

  /// Check whether an invoice has been paid.
  Future<bool> getInvoiceStatus(String apiKey, String paymentHash) async {
    final body = await _request('/api/v1/payments/$paymentHash',
        apiKey: apiKey);
    if (body is Map<String, dynamic>) {
      return body['paid'] == true || body['status'] == 'success';
    }
    return false;
  }

  String _readBolt11(Map<String, dynamic> json) {
    for (final key in ['bolt11', 'payment_request']) {
      final value = json[key];
      if (value is String && value.isNotEmpty) return value;
    }
    return '';
  }
}

/// Invoice created by LNbits.
class LnbitsInvoice {
  final String paymentHash;
  final String bolt11;
  const LnbitsInvoice({required this.paymentHash, required this.bolt11});
}
