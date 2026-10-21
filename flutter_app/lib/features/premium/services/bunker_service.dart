import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

/// Nostr Bunker (NIP-46 remote signer) as a premium service.
///
/// The `/nostr_bunker/api/v1` extension lets a user store an nsec server-side
/// and mint `bunker://` URLs (NIP-46) with per-connection permissions — so
/// the key never lives on the device, and signing happens remotely. This is a
/// genuinely premium security feature: the identity pillar's "key as account"
/// upgraded to "key held for you, used anywhere".
class BunkerException implements Exception {
  final String message;
  const BunkerException(this.message);
  @override
  String toString() => sanitizeText(message);
}

/// A stored key (`bunkers_data`).
class BunkerKey {
  final String id;
  final String name;
  const BunkerKey({required this.id, required this.name});

  factory BunkerKey.fromJson(Map<String, dynamic> json) => BunkerKey(
        id: json['id'] as String,
        name: sanitizeText(json['name'] as String? ?? 'Key'),
      );
}

/// One connection URL (`url_data`) with its permissions + relays.
class BunkerConnection {
  final String id;
  final String? name;
  final List<String> relays;
  final List<String> permissions;
  final String? bunkerUrl;
  final String? clientPubkey;

  const BunkerConnection({
    required this.id,
    this.name,
    this.relays = const [],
    this.permissions = const [],
    this.bunkerUrl,
    this.clientPubkey,
  });

  factory BunkerConnection.fromJson(Map<String, dynamic> json) =>
      BunkerConnection(
        id: json['id'] as String,
        name: sanitizeTextOrNull(json['name'] as String?),
        relays: (json['relays'] as List?)?.whereType<String>().toList() ?? [],
        permissions:
            (json['permissions'] as List?)?.whereType<String>().toList() ?? [],
        bunkerUrl: json['bunker_url'] as String?,
        clientPubkey: json['client_pubkey'] as String?,
      );
}

class BunkerService {
  BunkerService({String? baseUrl})
      : baseUrl = baseUrl ?? Env.lnbitsUrl.replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

  static const extId = 'nostr_bunker';

  // ── Keys ─────────────────────────────────────────────────────────────

  /// Create (store) a key. `POST /nostr_bunker/api/v1/bunkers_data`.
  Future<BunkerKey> createKey({
    required String token,
    String? name,
    String? nsec,
  }) async {
    final json = await _request<dynamic>(
      '/nostr_bunker/api/v1/bunkers_data',
      method: 'POST',
      token: token,
      body: {
        if (name != null && name.isNotEmpty) 'name': name,
        if (nsec != null && nsec.isNotEmpty) 'nsec': nsec,
      },
      parser: (json) => json,
    );
    return BunkerKey.fromJson(json as Map<String, dynamic>);
  }

  /// List stored keys (paginated — we read the first page).
  Future<List<BunkerKey>> listKeys({String? token}) async {
    final json = await _request<dynamic>(
      '/nostr_bunker/api/v1/bunkers_data/paginated?limit=1',
      token: token,
      parser: (json) => json,
    );
    final data = json is Map ? json['data'] : null;
    if (data is List) {
      return data
          .whereType<Map<String, dynamic>>()
          .map(BunkerKey.fromJson)
          .toList();
    }
    return [];
  }

  // ── Connections ──────────────────────────────────────────────────────

  /// Mint a `bunker://` connection URL for a key, with permissions.
  /// `POST /nostr_bunker/api/v1/url_data/{bunkersDataId}`.
  Future<BunkerConnection> createConnection({
    required String token,
    required String bunkersDataId,
    String? name,
    List<String>? relays,
    List<String>? permissions,
    bool autoSign = false,
    bool confirmSign = true,
  }) async {
    final json = await _request<dynamic>(
      '/nostr_bunker/api/v1/url_data/$bunkersDataId',
      method: 'POST',
      token: token,
      body: {
        if (name != null && name.isNotEmpty) 'name': name,
        if (relays != null && relays.isNotEmpty) 'relays': relays,
        if (permissions != null && permissions.isNotEmpty)
          'permissions': permissions,
        'auto_sign': autoSign,
        'confirm_sign': confirmSign,
      },
      parser: (json) => json,
    );
    return BunkerConnection.fromJson(json as Map<String, dynamic>);
  }

  /// List connection URLs for a key.
  Future<List<BunkerConnection>> listConnections({
    required String token,
    required String bunkersDataId,
  }) async {
    final json = await _request<dynamic>(
      '/nostr_bunker/api/v1/url_data/paginated?bunkers_data_id=$bunkersDataId&limit=20',
      token: token,
      parser: (json) => json,
    );
    final data = json is Map ? json['data'] : null;
    if (data is List) {
      return data
          .whereType<Map<String, dynamic>>()
          .map(BunkerConnection.fromJson)
          .toList();
    }
    return [];
  }

  /// Revoke a connection URL. `DELETE /nostr_bunker/api/v1/url_data/{id}`.
  Future<void> deleteConnection({
    required String token,
    required String urlDataId,
  }) async {
    await _request<dynamic>(
      '/nostr_bunker/api/v1/url_data/$urlDataId',
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
      throw BunkerException(message);
    }

    return parser(parsed);
  }
}
