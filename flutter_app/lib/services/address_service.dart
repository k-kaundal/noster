import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/env.dart';

/// The free address someone gets without paying — derived from their pubkey.
/// Stable, unique, and nothing leaked. Same algorithm as the web's
/// `lib/freeAddress.ts`.
class FreeAddress {
  static const _prefix = 'u';
  static const _length = 12;

  /// Derive a free address local part from a pubkey.
  static String generate(String pubkey) {
    final hex = pubkey.trim().toLowerCase().replaceAll(RegExp(r'[^0-9a-f]'), '');
    if (hex.length < _length) {
      return '$_prefix${hex.padRight(_length, '0')}'
          .substring(0, _prefix.length + _length);
    }
    return '$_prefix${hex.substring(0, _length)}';
  }

  /// Whether a name looks like one this app assigned.
  static bool isGenerated(String name) {
    return RegExp('^$_prefix[0-9a-f]{$_length}\$')
        .hasMatch(name.trim().toLowerCase());
  }
}

/// A pay link as returned by the lnurlp extension.
class PayLink {
  final String id;
  final String wallet;
  final String description;
  final String? username;
  final String? domain;
  final bool zaps;
  final bool disposable;
  final int min;
  final int max;
  final int commentChars;

  const PayLink({
    required this.id,
    required this.wallet,
    required this.description,
    this.username,
    this.domain,
    this.zaps = false,
    this.disposable = false,
    this.min = 0,
    this.max = 0,
    this.commentChars = 0,
  });

  factory PayLink.fromJson(Map<String, dynamic> json) => PayLink(
        id: json['id'] as String,
        wallet: json['wallet'] as String? ?? '',
        description: json['description'] as String? ?? '',
        username: json['username'] as String?,
        domain: json['domain'] as String?,
        zaps: json['zaps'] as bool? ?? false,
        disposable: json['disposable'] as bool? ?? false,
        min: (json['min'] as num?)?.toInt() ?? 0,
        max: (json['max'] as num?)?.toInt() ?? 0,
        commentChars: (json['comment_chars'] as num?)?.toInt() ?? 0,
      );

  /// The full lightning address for this link.
  String? get address {
    if (username == null || username!.isEmpty) return null;
    final d = domain ?? Env.lightningAddressDomain;
    return '$username@$d';
  }
}

/// A NIP-05 address as returned by the nostrnip5 extension.
class Nip5Address {
  final String id;
  final String domainId;
  final String localPart;
  final String pubkey;
  final bool active;
  final int? years;
  final Map<String, dynamic>? extra;

  const Nip5Address({
    required this.id,
    required this.domainId,
    required this.localPart,
    required this.pubkey,
    this.active = false,
    this.years,
    this.extra,
  });

  factory Nip5Address.fromJson(Map<String, dynamic> json) => Nip5Address(
        id: json['id'] as String,
        domainId: json['domain_id'] as String? ?? '',
        localPart: json['local_part'] as String? ?? '',
        pubkey: json['pubkey'] as String? ?? '',
        active: json['active'] as bool? ?? false,
        years: (json['years'] as num?)?.toInt(),
        extra: json['extra'] as Map<String, dynamic>?,
      );

  /// The full NIP-05 identifier.
  String get identifier {
    final domain = _domainForId(domainId);
    return '$localPart@$domain';
  }

  static String _domainForId(String domainId) {
    final domains = Env.nip5Domains.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty);
    for (final entry in domains) {
      final parts = entry.split(':');
      if (parts.length == 2 && parts[0] == domainId) return parts[1];
    }
    return Env.nip5Domain;
  }
}

/// A NIP-05 search result (availability + price).
class Nip5SearchResult {
  final bool available;
  final String? reason;
  final int? priceSats;
  final int? priceUsdCents;

  const Nip5SearchResult({
    required this.available,
    this.reason,
    this.priceSats,
    this.priceUsdCents,
  });

  factory Nip5SearchResult.fromJson(Map<String, dynamic> json) =>
      Nip5SearchResult(
        available: json['available'] as bool? ?? false,
        reason: json['reason'] as String?,
        priceSats: (json['price_sats'] as num?)?.toInt(),
        priceUsdCents: (json['price_usd_cents'] as num?)?.toInt(),
      );
}

/// Exception from a lightning address or NIP-05 call.
class AddressException implements Exception {
  final String message;
  const AddressException(this.message);
  @override
  String toString() => message;
}

/// Lightning address and NIP-05 service, backed by LNbits extensions.
class AddressService {
  AddressService({String? baseUrl})
      : baseUrl = baseUrl ??
            Env.lnbitsUrl.replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

  // ── Pay Links (lnurlp) ─────────────────────────────────────────────

  /// List all pay links on the account (across all wallets).
  Future<List<PayLink>> listPayLinks({
    required String apiKey,
    String? token,
  }) async {
    try {
      return await _request<List<PayLink>>(
        '/lnurlp/api/v1/links?all_wallets=true',
        apiKey: apiKey,
        token: token,
        parser: (json) => (json as List)
            .whereType<Map<String, dynamic>>()
            .map(PayLink.fromJson)
            .toList(),
      );
    } catch (_) {
      // Retry without all_wallets if the server objects
      return _request<List<PayLink>>(
        '/lnurlp/api/v1/links',
        apiKey: apiKey,
        token: token,
        parser: (json) => (json as List)
            .whereType<Map<String, dynamic>>()
            .map(PayLink.fromJson)
            .toList(),
      );
    }
  }

  /// Create a new pay link (claim a lightning address).
  Future<PayLink> createPayLink({
    required String apiKey,
    String? token,
    required String username,
    String? domain,
    required String walletId,
    String? displayName,
  }) async {
    final body = <String, dynamic>{
      'description': displayName ?? username,
      'username': username,
      'wallet': walletId,
      'min': 1,
      'max': 1000000,
      'comment_chars': 200,
      'zaps': true,
      if (domain != null) 'domain': domain,
    };

    return _request<PayLink>(
      '/lnurlp/api/v1/links',
      method: 'POST',
      apiKey: apiKey,
      token: token,
      body: body,
      parser: (json) => PayLink.fromJson(json as Map<String, dynamic>),
    );
  }

  /// Enable zaps on an existing pay link.
  Future<void> enableZaps({
    required String apiKey,
    String? token,
    required PayLink link,
  }) async {
    await _request<PayLink>(
      '/lnurlp/api/v1/links/${link.id}',
      method: 'PUT',
      apiKey: apiKey,
      token: token,
      body: {
        'zaps': true,
      },
      parser: (json) => PayLink.fromJson(json as Map<String, dynamic>),
    );
  }

  // ── NIP-05 (nostrnip5) ─────────────────────────────────────────────

  /// Check if the nostrnip5 extension is available.
  Future<bool> isNip5Available({String? token}) async {
    try {
      await _request<dynamic>(
        '/nostrnip5/api/v1/domain/${Env.nip5DomainId}/search?q=test',
        token: token,
        parser: (json) => json,
      );
      return true;
    } catch (e) {
      if (e is AddressException && e.message.contains('404')) return false;
      return true; // Other errors mean the extension exists but the request failed
    }
  }

  /// Search for a NIP-05 name (availability + price).
  Future<Nip5SearchResult> searchNip5({
    required String localPart,
    int years = 1,
    String? domainId,
    String? token,
  }) async {
    final did = domainId ?? Env.nip5DomainId;
    return _request<Nip5SearchResult>(
      '/nostrnip5/api/v1/domain/$did/search?q=${Uri.encodeComponent(localPart)}&years=$years',
      token: token,
      parser: (json) =>
          Nip5SearchResult.fromJson(json as Map<String, dynamic>),
    );
  }

  /// List the user's NIP-05 addresses.
  Future<List<Nip5Address>> listNip5Addresses({String? token}) async {
    return _request<List<Nip5Address>>(
      '/nostrnip5/api/v1/user/addresses',
      token: token,
      parser: (json) => (json as List)
          .whereType<Map<String, dynamic>>()
          .map(Nip5Address.fromJson)
          .toList(),
    );
  }

  /// Claim a NIP-05 name.
  Future<Nip5ClaimResult> claimNip5({
    required String localPart,
    required int years,
    required String pubkey,
    String? domainId,
    String? promoCode,
    String? token,
  }) async {
    final did = domainId ?? Env.nip5DomainId;
    final body = <String, dynamic>{
      'domain_id': did,
      'local_part': localPart,
      'pubkey': pubkey,
      'years': years,
      'create_invoice': true,
      if (promoCode != null && promoCode.isNotEmpty) 'promo_code': promoCode,
    };

    final json = await _request<dynamic>(
      '/nostrnip5/api/v1/user/domain/$did/address',
      method: 'POST',
      token: token,
      body: body,
      parser: (json) => json,
    );

    final jsonMap = json as Map<String, dynamic>;
    return Nip5ClaimResult(
      address: jsonMap['address'] != null
          ? Nip5Address.fromJson(jsonMap['address'] as Map<String, dynamic>)
          : null,
      bolt11: _readBolt11(jsonMap),
      paymentHash: jsonMap['payment_hash'] as String?,
      domainId: did,
    );
  }

  /// Check a NIP-05 payment status.
  Future<bool> checkNip5Payment({
    required String paymentHash,
    String? domainId,
    String? token,
  }) async {
    final did = domainId ?? Env.nip5DomainId;
    try {
      final json = await _request<dynamic>(
        '/nostrnip5/api/v1/domain/$did/payments/$paymentHash',
        token: token,
        parser: (json) => json,
      );
      if (json is Map<String, dynamic>) {
        return json['paid'] == true || json['status'] == 'success';
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Attach a lightning address to a NIP-05 name.
  Future<void> attachLightningToNip5({
    required String addressId,
    required String walletId,
    String? domainId,
    String? token,
    int? minSats,
    int? maxSats,
  }) async {
    final did = domainId ?? Env.nip5DomainId;
    await _request<dynamic>(
      '/nostrnip5/api/v1/user/domain/$did/address/$addressId/lnaddress',
      method: 'PUT',
      token: token,
      body: {
        'wallet_id': walletId,
        if (minSats != null) 'min': minSats,
        if (maxSats != null) 'max': maxSats,
      },
      parser: (json) => json,
    );
  }

  // ── Low-level request ──────────────────────────────────────────────

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
      if (apiKey != null) 'X-API-KEY': apiKey,
      if (token != null) 'Authorization': 'Bearer $token',
    };

    final request = http.Request(method, uri);
    request.headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);

    final streamed =
        await request.send().timeout(const Duration(seconds: 15));
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
      throw AddressException(message);
    }

    return parser(parsed);
  }

  String _readBolt11(Map<String, dynamic> json) {
    for (final key in ['bolt11', 'payment_request', 'invoice']) {
      final value = json[key];
      if (value is String && value.isNotEmpty) return value;
    }
    return '';
  }
}

/// Result of claiming a NIP-05 name.
class Nip5ClaimResult {
  final Nip5Address? address;
  final String bolt11;
  final String? paymentHash;
  final String domainId;

  const Nip5ClaimResult({
    this.address,
    required this.bolt11,
    this.paymentHash,
    required this.domainId,
  });
}
