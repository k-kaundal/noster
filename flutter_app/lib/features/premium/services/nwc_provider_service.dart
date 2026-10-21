import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

/// NWC Service Provider — let a user mint `nostr+walletconnect://` URIs for
/// their own wallet, with permissions + budgets (Alby-Hub-style). A premium
/// feature: share self-custody access to a wallet with an app, capped and
/// revocable, without handing over the key itself.
class NwcProviderException implements Exception {
  final String message;
  const NwcProviderException(this.message);
  @override
  String toString() => sanitizeText(message);
}

/// A registered NWC connection (`NWCKey` + budgets).
class NwcProviderConnection {
  final String pubkey;
  final String wallet;
  final String? description;
  final int? expiresAt;
  final List<String> permissions;
  final int? lastUsed;

  const NwcProviderConnection({
    required this.pubkey,
    required this.wallet,
    this.description,
    this.expiresAt,
    this.permissions = const [],
    this.lastUsed,
  });

  factory NwcProviderConnection.fromJson(Map<String, dynamic> json) {
    final data = json['data'] is Map
        ? json['data'] as Map<String, dynamic>
        : json;
    return NwcProviderConnection(
      pubkey: data['pubkey'] as String? ?? '',
      wallet: data['wallet'] as String? ?? '',
      description: sanitizeTextOrNull(data['description'] as String?),
      expiresAt: (data['expires_at'] as num?)?.toInt(),
      permissions:
          (data['permissions'] as List?)?.whereType<String>().toList() ?? [],
      lastUsed: (data['last_used'] as num?)?.toInt(),
    );
  }
}

class NwcProviderService {
  NwcProviderService({String? baseUrl})
      : baseUrl = baseUrl ?? Env.lnbitsUrl.replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

  static const extId = 'nwcprovider';

  /// The URI scheme this provider mints for a pairing secret.
  /// `GET /nwcprovider/api/v1/pairing/{secret}` → the connection string.
  Future<String> getPairingUrl(String secret) async {
    final json = await _request<dynamic>(
      '/nwcprovider/api/v1/pairing/${Uri.encodeComponent(secret)}',
      parser: (json) => json,
    );
    if (json is String) return json;
    if (json is Map) {
      for (final key in ['uri', 'url', 'pairing_uri', 'connection_string']) {
        final v = json[key];
        if (v is String && v.isNotEmpty) return v;
      }
    }
    return '';
  }

  /// List registered NWC connections. `GET /nwcprovider/api/v1/nwc`.
  Future<List<NwcProviderConnection>> listConnections({String? token}) async {
    final json = await _request<dynamic>(
      '/nwcprovider/api/v1/nwc',
      token: token,
      parser: (json) => json,
    );
    if (json is List) {
      return json
          .whereType<Map<String, dynamic>>()
          .map(NwcProviderConnection.fromJson)
          .toList();
    }
    return [];
  }

  /// Register a new NWC connection for one of the user's wallets.
  /// `PUT /nwcprovider/api/v1/nwc/{pubkey}`. Returns the connection + the
  /// pairing URI the caller shows once (the secret is not recoverable later).
  Future<(NwcProviderConnection, String)> registerConnection({
    required String token,
    required String pubkey,
    required List<String> permissions,
    String? description,
    int? expiresAt,
    int? budgetMsats,
    int? budgetRefreshWindow,
  }) async {
    final json = await _request<dynamic>(
      '/nwcprovider/api/v1/nwc/$pubkey',
      method: 'PUT',
      token: token,
      body: {
        'permissions': permissions,
        'description': ?description,
        'expires_at': ?expiresAt,
        if (budgetMsats != null)
          'budgets': [
            {
              'budget_msats': budgetMsats,
              'refresh_window': ?budgetRefreshWindow,
              'created_at': DateTime.now().millisecondsSinceEpoch ~/ 1000,
            }
          ],
      },
      parser: (json) => json,
    );
    final conn = NwcProviderConnection.fromJson(json as Map<String, dynamic>);
    final uri = conn.pubkey.isNotEmpty ? await getPairingUrl(conn.pubkey) : '';
    return (conn, uri);
  }

  /// Revoke a connection. `DELETE /nwcprovider/api/v1/nwc/{pubkey}`.
  Future<void> deleteConnection({
    required String token,
    required String pubkey,
  }) async {
    await _request<dynamic>(
      '/nwcprovider/api/v1/nwc/$pubkey',
      method: 'DELETE',
      token: token,
      parser: (json) => json,
    );
  }

  // ── Low-level request ────────────────────────────────────────────────

  Future<T> _request<T>(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
    String? token,
    required T Function(dynamic) parser,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      if (body != null) 'Content-Type': 'application/json',
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
      throw NwcProviderException(message);
    }

    return parser(parsed);
  }
}
