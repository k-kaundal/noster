import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';

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
        // Free text (defaults to the display name) — rendered in address lists.
        description: sanitizeText(json['description'] as String? ?? ''),
        username: sanitizeTextOrNull(json['username'] as String?),
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

/// One domain names can be bought under: the extension's id, and the hostname.
class Nip5Domain {
  /// The extension's own id, which every request is addressed to.
  final String id;
  /// What the name reads as, and where clients look for the well-known file.
  final String domain;

  const Nip5Domain({required this.id, required this.domain});
}

/// Reads `Env.nip5Domains` (and the singular `Env.nip5DomainId`/`Env.nip5Domain`)
/// into a list of domains, best first.
///
/// Both halves have to be configured because neither can be discovered: the
/// extension lists domains behind a wallet key, and its public search route
/// returns the local part alone with no hostname in the reply.
///
/// Written as `id:hostname` pairs, and read either way round: the half with a
/// dot in it is the hostname, since a domain id has none and a hostname always
/// does. Ordering is kept, so the first entry stays the default.
List<Nip5Domain> parseNip5Domains() {
  final domains = <Nip5Domain>[];

  // The singular setting names the primary, so it stays the default.
  final primaryId = Env.nip5DomainId.trim();
  if (primaryId.isNotEmpty) {
    domains.add(Nip5Domain(
      id: primaryId,
      domain: Env.nip5Domain.trim().toLowerCase(),
    ));
  }

  // `Env.nip5Domains` adds the rest as `id:hostname` pairs, separated by
  // commas or whitespace.
  for (final entry in Env.nip5Domains.split(RegExp(r'[\s,]+'))) {
    if (entry.isEmpty) continue;

    final parts = entry.split(RegExp(r'[:=]')).where((s) => s.isNotEmpty).toList();
    if (parts.length < 2) continue;

    final domain = parts.firstWhere(
      (p) => p.contains('.'),
      orElse: () => '',
    );
    final id = parts.firstWhere(
      (p) => p != domain,
      orElse: () => '',
    );
    if (domain.isEmpty || id.isEmpty) continue;

    // First one wins, so a repeat in the config cannot reorder the default.
    if (domains.any((existing) => existing.id == id)) continue;

    domains.add(Nip5Domain(id: id.trim(), domain: domain.trim().toLowerCase()));
  }

  return domains;
}

/// Every domain this deployment sells names under, best first.
final nip5Domains = parseNip5Domains();

/// Every domain a lightning address can be claimed under, best first.
///
/// The singular `Env.lightningAddressDomain` names the primary, so it stays
/// the default; `Env.lightningAddressDomains` adds the rest as bare hostnames
/// separated by commas or whitespace (pay links address a domain by its
/// hostname, no extension id needed).
List<String> parseLightningAddressDomains() {
  final domains = <String>[];
  void add(String raw) {
    final d = raw.trim().toLowerCase();
    if (d.isEmpty || !d.contains('.')) return;
    if (!domains.contains(d)) domains.add(d);
  }

  add(Env.lightningAddressDomain);
  for (final entry in Env.lightningAddressDomains.split(RegExp(r'[\s,]+'))) {
    add(entry);
  }
  return domains;
}

final lightningAddressDomains = parseLightningAddressDomains();

/// The configured domain with this id, when it is one of ours.
Nip5Domain? nip5DomainById(String? id) {
  if (id == null) return null;
  for (final d in nip5Domains) {
    if (d.id == id) return d;
  }
  return null;
}

/// The hostname a domain id reads as. Falls back to the default.
String nip5Host(String? domainId) {
  return nip5DomainById(domainId)?.domain ??
      (nip5Domains.isEmpty ? Env.nip5Domain : nip5Domains.first.domain);
}

/// A NIP-05 address as returned by the nostrnip5 extension.
///
/// `active: false` means the invoice has not settled — the name is RESERVED
/// but never went live. That is NOT the same as expired (a paid name that
/// lapsed): an unpaid name has no renew button, it has a "pay for it" one.
/// Mirrors the web's `nip5State`.
class Nip5Address {
  final String id;
  final String domainId;
  final String localPart;
  final String pubkey;
  final bool active;
  final bool isFree;
  final int? years;

  /// ISO 8601 — written when the record is CREATED (so an unpaid reservation
  /// carries a date a year out), only meaningful once `active`.
  final String? expiresAt;
  final Map<String, dynamic>? extra;

  const Nip5Address({
    required this.id,
    required this.domainId,
    required this.localPart,
    required this.pubkey,
    this.active = false,
    this.isFree = false,
    this.years,
    this.expiresAt,
    this.extra,
  });

  factory Nip5Address.fromJson(Map<String, dynamic> json) {
    final extra = json['extra'] as Map<String, dynamic>?;
    return Nip5Address(
      id: json['id'] as String,
      domainId: json['domain_id'] as String? ?? '',
      // API-sourced — sanitize before it reaches a Text widget (the
      // identifier renders in monospace in several places).
      localPart: sanitizeText(json['local_part'] as String? ?? ''),
      pubkey: json['pubkey'] as String? ?? '',
      active: json['active'] as bool? ?? false,
      isFree: json['is_free'] as bool? ?? false,
      // `years` can live on the record or inside extra, depending on route.
      years: (json['years'] as num?)?.toInt() ??
          (extra?['years'] as num?)?.toInt(),
      expiresAt: json['expires_at'] as String?,
      extra: extra,
    );
  }

  /// The full NIP-05 identifier, using the address's own domain.
  String get identifier => '$localPart@${nip5Host(domainId)}';

  /// Whether this name is reserved-but-unpaid (never went live).
  bool get isUnpaid => !active;

  /// Expiry as epoch ms, or null when the name does not expire. Only real
  /// once active — the date exists on an unpaid reservation too, but says
  /// nothing (see web's `RentedUntil`, which renders nothing when unpaid).
  int? get expiresAtMs {
    final raw = expiresAt;
    if (raw == null) return null;
    return DateTime.tryParse(raw)?.millisecondsSinceEpoch;
  }

  /// Whole days left, negative once lapsed. Null when it never expires.
  int? get daysUntilExpiry {
    final expiry = expiresAtMs;
    if (expiry == null) return null;
    final now = DateTime.now().millisecondsSinceEpoch;
    return ((expiry - now) / 86400000).ceil();
  }

  /// Payment hash for an unpaid reservation, when the server recorded one.
  /// (The extension only writes `extra.payment_hash` at activation, so this
  /// is usually empty while unpaid — the app's own stored hash covers that
  /// window, see `nip5_providers` pending-invoice store.)
  String? get outstandingPaymentHash {
    if (active) return null;
    final hash = extra?['payment_hash'];
    return hash is String && hash.isNotEmpty ? hash : null;
  }

  /// The price the invoice asked for, in sats, when recorded.
  int? get priceSats {
    final v = extra?['price_in_sats'] ?? extra?['price'];
    return (v as num?)?.toInt();
  }

  /// The promo code the reservation was made with, so paying later re-prices
  /// it the same rather than at full rate.
  String? get promoCode {
    final v = extra?['promo_code'];
    return v is String && v.isNotEmpty ? v : null;
  }
}

/// How long before expiry the renewal warning starts (web RENEWAL_WINDOW_DAYS).
const nip5RenewalWindowDays = 30;

/// The state worth telling someone about (web `nip5State`).
enum Nip5Status { inactive, expired, expiring, active }

/// `active: false` comes first because the extension uses it for a name whose
/// invoice has not settled — that one is not expired, it was never live.
Nip5Status nip5Status(Nip5Address a) {
  if (!a.active) return Nip5Status.inactive;
  final days = a.daysUntilExpiry;
  if (days == null) return Nip5Status.active;
  if (days <= 0) return Nip5Status.expired;
  if (days <= nip5RenewalWindowDays) return Nip5Status.expiring;
  return Nip5Status.active;
}

/// A NIP-05 search result (availability + price).
///
/// The extension prices a name in the domain's currency and converts to sats
/// at quote time, so both numbers can be present — the fiat figure is what was
/// agreed, the sats figure is what the invoice will ask for and it moves.
class Nip5SearchResult {
  final bool available;
  final String? reason;
  /// The list price in the domain's own currency (e.g. USD), when it has one.
  final double? price;
  /// The invoice amount in sats.
  final int? priceSats;
  /// The currency `price` is in (e.g. `USD`, `EUR`, `sats`).
  final String? currency;
  /// Why it costs that, e.g. a character-count or rank rule.
  final String? priceReason;
  final int? priceUsdCents;

  const Nip5SearchResult({
    required this.available,
    this.reason,
    this.price,
    this.priceSats,
    this.currency,
    this.priceReason,
    this.priceUsdCents,
  });

  factory Nip5SearchResult.fromJson(Map<String, dynamic> json) =>
      Nip5SearchResult(
        available: json['available'] as bool? ?? false,
        // API-sourced free text rendered in the UI — sanitize.
        reason: sanitizeText(json['reason'] as String?),
        price: (json['price'] as num?)?.toDouble(),
        priceSats: (json['price_in_sats'] as num?)?.toInt() ??
            (json['price_sats'] as num?)?.toInt(),
        currency: json['currency'] as String?,
        priceReason: sanitizeText(json['price_reason'] as String?),
        priceUsdCents: (json['price_usd_cents'] as num?)?.toInt(),
      );

  /// Whether the price is stated in fiat (a real currency), not in sats.
  bool get isFiatPriced {
    final c = (currency ?? '').trim().toLowerCase();
    return c.isNotEmpty && c != 'sat' && c != 'sats' && c != 'satoshi' && c != 'satoshis';
  }

  /// A short human-readable price, e.g. `$5.00 / year (≈ 8,400 sats)` or
  /// `8,400 sats / year`. Falls back to `Free` when the server says zero.
  String describePrice({int years = 1}) {
    final per = years > 1 ? '$years years' : 'year';
    final sats = priceSats;

    if (price == null && sats == null) return 'Free';

    if (!isFiatPriced) {
      final amount = sats ?? price?.round() ?? 0;
      return '${_formatSats(amount)} sats / $per';
    }

    final fiat = _formatFiat(price!, currency!);
    return sats != null
        ? '$fiat / $per (≈ ${_formatSats(sats)} sats)'
        : '$fiat / $per';
  }

  static String _formatSats(int sats) {
    // Simple thousands separator
    final s = sats.toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      final idx = s.length - i;
      buf.write(s[i]);
      if (idx > 1 && idx % 3 == 1) buf.write(',');
    }
    return buf.toString();
  }

  static String _formatFiat(double amount, String currency) {
    final c = currency.trim().toUpperCase();
    final symbol = switch (c) {
      'USD' => '\$',
      'EUR' => '€',
      'GBP' => '£',
      _ => '',
    };
    if (symbol.isNotEmpty) return '$symbol${amount.toStringAsFixed(2)}';
    return '${amount.toStringAsFixed(2)} $c';
  }
}

/// Exception from a lightning address or NIP-05 call.
class AddressException implements Exception {
  final String message;
  const AddressException(this.message);
  /// Server `detail` text is rendered via toString in dialogs/toasts —
  /// sanitize there so a malformed server message can't crash the text engine.
  @override
  String toString() => sanitizeText(message);
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
      'domain': ?domain,
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

  /// Delete a pay link (lightning address). `DELETE /lnurlp/api/v1/links/{id}`.
  ///
  /// The web app deliberately never deletes lightning addresses (docs: the
  /// next claimant would start receiving money aimed at the previous owner).
  /// Offered here for symmetry with the NIP-05 release — the CALLER decides,
  /// with a confirm, whether freeing an address is worth that risk.
  Future<void> deletePayLink({
    required String apiKey,
    String? token,
    required String linkId,
  }) async {
    await _request<dynamic>(
      '/lnurlp/api/v1/links/$linkId',
      method: 'DELETE',
      apiKey: apiKey,
      token: token,
      parser: (json) => json,
    );
  }

  // ── NIP-05 (nostrnip5) ─────────────────────────────────────────────

  /// Check if the nostrnip5 extension is available on this instance.
  ///
  /// Hits the default domain's public search route — a 404 means the extension
  /// isn't installed, anything else means it is (even if the request itself
  /// failed for another reason).
  Future<bool> isNip5Available({String? token}) async {
    final defaultDomainId =
        nip5Domains.isEmpty ? Env.nip5DomainId : nip5Domains.first.id;
    if (defaultDomainId.isEmpty) return false;
    try {
      await _request<dynamic>(
        '/nostrnip5/api/v1/domain/$defaultDomainId/search?q=test',
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
        'min': ?minSats,
        'max': ?maxSats,
      },
      parser: (json) => json,
    );
  }

  /// Delete one of the user's own NIP-05 addresses (user-scoped route).
  ///
  /// For an UNPAID (reserved, never-live) name this RELEASES it back to the
  /// pool immediately — the whole point of the anti-squatting guard. For a
  /// PAID/active name it also deletes; the caller confirms separately because
  /// that throws away money.
  ///
  /// `DELETE /nostrnip5/api/v1/user/domain/{did}/address/{addressId}`
  Future<void> deleteNip5Address({
    required String addressId,
    String? domainId,
    String? token,
  }) async {
    final did = domainId ?? Env.nip5DomainId;
    await _request<dynamic>(
      '/nostrnip5/api/v1/user/domain/$did/address/$addressId',
      method: 'DELETE',
      token: token,
      parser: (json) => json,
    );
  }

  /// Get a transfer code for an address the user owns (starts a transfer to
  /// another user). `GET .../address/{addressId}/transfer` → `{ transfer_code }`.
  Future<String> getNip5TransferCode({
    required String addressId,
    String? domainId,
    String? token,
  }) async {
    final did = domainId ?? Env.nip5DomainId;
    final json = await _request<dynamic>(
      '/nostrnip5/api/v1/domain/$did/address/$addressId/transfer',
      token: token,
      parser: (json) => json,
    );
    final code = (json as Map<String, dynamic>)['transfer_code'];
    return code is String ? code : '';
  }

  /// Lock an identifier for transfer (only the returned lock code can unlock
  /// or complete it). `PUT .../address/lock` → `{ lock_code }`.
  Future<String> lockNip5Address({
    required String transferCode,
    String? domainId,
    String? token,
  }) async {
    final did = domainId ?? Env.nip5DomainId;
    final json = await _request<dynamic>(
      '/nostrnip5/api/v1/domain/$did/address/lock',
      method: 'PUT',
      token: token,
      body: {'transfer_code': transferCode},
      parser: (json) => json,
    );
    final code = (json as Map<String, dynamic>)['lock_code'];
    return code is String ? code : '';
  }

  /// Rotate the pubkey an address verifies (re-point the name at a different
  /// Nostr key). `PUT .../address/{addressId}/rotate`.
  Future<void> rotateNip5Address({
    required String addressId,
    required String secret,
    required String pubkey,
    String? domainId,
    String? token,
  }) async {
    final did = domainId ?? Env.nip5DomainId;
    await _request<dynamic>(
      '/nostrnip5/api/v1/domain/$did/address/$addressId/rotate',
      method: 'PUT',
      token: token,
      body: {'secret': secret, 'pubkey': pubkey},
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
      'X-API-KEY': ?apiKey,
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
