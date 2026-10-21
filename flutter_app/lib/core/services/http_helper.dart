import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';

/// Shared HTTP helpers for API services (LNbits, Cashu, LNURL, GetZap).
///
/// Replaces the `http.get → timeout → statusCode check → jsonDecode` blocks
/// that were copy-pasted ~9 times across `cashu_service.dart` and
/// `lnurl_service.dart`.
class ApiHttpException implements Exception {
  final int statusCode;
  final String body;
  final String method;
  final Uri url;

  ApiHttpException({
    required this.statusCode,
    required this.body,
    required this.method,
    required this.url,
  });

  /// Extracts a human-readable message from common API error shapes
  /// (FastAPI `detail`, LNbits `message`, or raw body).
  String get userMessage {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        final detail = decoded['detail'] ?? decoded['message'];
        if (detail is String) return detail;
        if (detail is List && detail.isNotEmpty) {
          final first = detail.first;
          if (first is Map && first['msg'] is String) return first['msg'] as String;
        }
      }
    } catch (_) {
      // Body wasn't JSON — fall through to raw snippet.
    }
    final snippet = body.length > 120 ? '${body.substring(0, 120)}…' : body;
    return 'HTTP $statusCode: $snippet';
  }

  @override
  String toString() =>
      'ApiHttpException($method $url → $statusCode): $userMessage';
}

/// Thin wrapper around `package:http` with consistent timeouts and
/// structured error handling.
class ApiHttpClient {
  final Duration timeout;

  const ApiHttpClient({this.timeout = AppDurations.http});

  Future<Map<String, dynamic>> getJson(
    Uri url, {
    Map<String, String>? headers,
  }) async {
    final res = await http.get(url, headers: headers).timeout(timeout);
    _throwIfNotOk('GET', url, res);
    return _decodeObject(res.body);
  }

  Future<Map<String, dynamic>> postJson(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
  }) async {
    final res = await http
        .post(
          url,
          headers: {'Content-Type': 'application/json', ...?headers},
          body: body == null ? null : jsonEncode(body),
        )
        .timeout(timeout);
    _throwIfNotOk('POST', url, res);
    return _decodeObject(res.body);
  }

  Future<Map<String, dynamic>> deleteJson(
    Uri url, {
    Map<String, String>? headers,
  }) async {
    final res = await http.delete(url, headers: headers).timeout(timeout);
    _throwIfNotOk('DELETE', url, res);
    return _decodeObject(res.body);
  }

  /// GET that tolerates non-2xx by returning null (for probe-style lookups
  /// like LNURL resolution where 404 simply means "doesn't exist").
  Future<Map<String, dynamic>?> tryGetJson(
    Uri url, {
    Map<String, String>? headers,
  }) async {
    try {
      final res = await http.get(url, headers: headers).timeout(timeout);
      if (res.statusCode < 200 || res.statusCode >= 300) return null;
      return _decodeObject(res.body);
    } catch (_) {
      return null;
    }
  }

  static void _throwIfNotOk(String method, Uri url, http.Response res) {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw ApiHttpException(
        statusCode: res.statusCode,
        body: res.body,
        method: method,
        url: url,
      );
    }
  }

  static Map<String, dynamic> _decodeObject(String body) {
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) return decoded;
    return {'data': decoded};
  }
}
