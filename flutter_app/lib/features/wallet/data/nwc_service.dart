import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:hex/hex.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:pointycastle/export.dart' as pc;

/// NIP-47 (Nostr Wallet Connect) service.
///
/// Talks to a wallet service over Nostr relays using encrypted kind-23194
/// requests and kind-23195 responses, both NIP-04 encrypted to the wallet
/// service pubkey extracted from the `nostr+walletconnect://` URI.
///
/// A NWC URI looks like:
/// `nostr+walletconnect://<walletPubkey>?relay=wss://...&secret=<32-byte-hex>`
///
/// - `walletPubkey` is who we encrypt requests to.
/// - `relay` is where the wallet listens.
/// - `secret` becomes the ephemeral keypair the wallet uses to recognise this
///   client; its pubkey is what the wallet whitelists.
class NwcService {
  final AuthService _auth;

  NwcService(this._auth);

  // ── Connection state ───────────────────────────────────────────────

  String? _connectionString;
  String? _walletPubkey;
  List<String> _relays = const [];
  String? _clientSecret;
  String? _clientPubkey;
  NwcInfo? _info;
  DateTime? _connectedAt;

  /// Encryption scheme for requests: 'nip44' (modern wallets) or 'nip04'
  /// (legacy). Auto-detected from the wallet's `get_info` advertisement, or
  /// negotiated by trying NIP-44 first and falling back on failure.
  String _encryption = 'nip44_v2';

  String? get connectionString => _connectionString;
  String? get walletPubkey => _walletPubkey;
  String? get clientPubkey => _clientPubkey;
  NwcInfo? get info => _info;
  bool get isConnected => _connectionString != null && _clientSecret != null;
  DateTime? get connectedAt => _connectedAt;

  /// Capabilities advertised by the wallet through `get_info`.
  List<String> get supportedMethods => _info?.methods ?? const [];

  bool get canMakeInvoice =>
      supportedMethods.contains('make_invoice') ||
      supportedMethods.contains('get_balance') ||
      supportedMethods.isEmpty;

  bool get canPayInvoice =>
      supportedMethods.contains('pay_invoice') || supportedMethods.isEmpty;

  bool get canListTransactions =>
      supportedMethods.contains('list_transactions') ||
      supportedMethods.isEmpty;

  bool get canLookupInvoice => supportedMethods.contains('lookup_invoice');

  // ── URI parsing ────────────────────────────────────────────────────

  /// Parse a `nostr+walletconnect://` or `nostrwalletconnect://` URI.
  /// Returns null when malformed.
  static NwcUri? parseUri(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) return null;

    final lower = trimmed.toLowerCase();
    String rest;
    if (lower.startsWith('nostr+walletconnect://')) {
      rest = trimmed.substring('nostr+walletconnect://'.length);
    } else if (lower.startsWith('nostrwalletconnect://')) {
      rest = trimmed.substring('nostrwalletconnect://'.length);
    } else {
      return null;
    }

    // Split host (pubkey) from query string
    final queryIdx = rest.indexOf('?');
    final pubkeyPart = queryIdx == -1 ? rest : rest.substring(0, queryIdx);
    final queryPart = queryIdx == -1 ? '' : rest.substring(queryIdx + 1);

    if (pubkeyPart.length != 64 ||
        !RegExp(r'^[0-9a-fA-F]+$').hasMatch(pubkeyPart)) {
      return null;
    }

    // Parse query params manually — NIP-47 allows MULTIPLE relay params,
    // which Uri.splitQueryString collapses to the last one.
    String? secret;
    String? lud16;
    final relays = <String>[];
    for (final pair in queryPart.split('&')) {
      if (pair.isEmpty) continue;
      final eq = pair.indexOf('=');
      if (eq < 0) continue;
      final key = Uri.decodeQueryComponent(pair.substring(0, eq));
      final value = Uri.decodeQueryComponent(pair.substring(eq + 1));
      switch (key) {
        case 'secret':
          secret = value;
        case 'relay':
          if (value.startsWith('wss://') || value.startsWith('ws://')) {
            relays.add(value);
          }
        case 'lud16':
          lud16 = value;
      }
    }

    if (secret == null || secret.length != 64) return null;
    if (relays.isEmpty) return null;

    return NwcUri(
      walletPubkey: pubkeyPart.toLowerCase(),
      relays: relays,
      secret: secret.toLowerCase(),
      lud16: lud16,
    );
  }

  // ── Connection lifecycle ───────────────────────────────────────────

  /// Connect using a NWC URI. Pings the wallet with `get_info` and returns
  /// the advertised capabilities. Throws on failure.
  Future<NwcInfo> connect(String uri, {required NostrService nostr}) async {
    final parsed = parseUri(uri);
    if (parsed == null) {
      throw const FormatException('Invalid NWC connection string');
    }

    _connectionString = uri;
    _walletPubkey = parsed.walletPubkey;
    _relays = parsed.relays;
    _clientSecret = parsed.secret;
    _clientPubkey = _derivePubkey(parsed.secret);

    // Ping the wallet. If it doesn't respond we consider this a failed connect.
    final response = await _request(
      method: 'get_info',
      params: const {},
      nostr: nostr,
      timeout: const Duration(seconds: 12),
    );

    if (response.error != null) {
      _reset();
      throw NwcException(
          response.error!.code, response.error!.message ?? 'Connection failed');
    }

    final result = (response.result as Map?)?.cast<String, dynamic>() ?? {};
    _info = NwcInfo(
      // Decrypted Nostr data — rendered as the wallet's display name; a lone
      // surrogate here crashes the text engine.
      alias: sanitizeTextOrNull(result['alias'] as String?),
      color: result['color'] as String?,
      pubkey: result['pubkey'] as String?,
      network: result['network'] as String?,
      blockHeight: result['block_height'] as int?,
      blockHash: result['block_hash'] as String?,
      methods: (result['methods'] as List?)?.cast<String>() ?? const [],
      notifications:
          (result['notifications'] as List?)?.cast<String>() ?? const [],
      lud16: parsed.lud16,
    );
    // Honor the wallet's advertised encryption (NWC spec: 'nip44_v2' or
    // 'nip04'). Default to what we sent the probe with.
    final advertised = result['encryption'] as String?;
    if (advertised != null && advertised.isNotEmpty) {
      _encryption = advertised;
    }
    _connectedAt = DateTime.now();
    return _info!;
  }

  void disconnect() => _reset();

  void _reset() {
    _connectionString = null;
    _walletPubkey = null;
    _relays = const [];
    _clientSecret = null;
    _clientPubkey = null;
    _info = null;
    _connectedAt = null;
  }

  // ── Wallet operations ──────────────────────────────────────────────

  Future<int> getBalance(NostrService nostr) async {
    final response = await _request(
      method: 'get_balance',
      params: const {},
      nostr: nostr,
    );
    _throwOnError(response);
    final result = (response.result as Map?)?.cast<String, dynamic>() ?? {};
    final balanceMsat = (result['balance'] as num?)?.toInt() ?? 0;
    return balanceMsat ~/ 1000; // return sats
  }

  Future<NwcPayResponse> payInvoice({
    required String invoice,
    int? amountSats, // only for amountless invoices
    required NostrService nostr,
  }) async {
    final response = await _request(
      method: 'pay_invoice',
      params: {
        'invoice': invoice,
        if (amountSats != null) 'amount': amountSats * 1000,
      },
      nostr: nostr,
      timeout: const Duration(seconds: 30),
    );
    _throwOnError(response);
    final result = (response.result as Map?)?.cast<String, dynamic>() ?? {};
    return NwcPayResponse(
      preimage: result['preimage'] as String? ?? '',
      feesPaidMsat: (result['fees_paid'] as num?)?.toInt(),
    );
  }

  Future<NwcInvoice> makeInvoice({
    required int amountSats,
    String? description,
    String? descriptionHash,
    int? expiry,
    required NostrService nostr,
  }) async {
    final response = await _request(
      method: 'make_invoice',
      params: {
        'amount': amountSats * 1000,
        'description': ?description,
        'description_hash': ?descriptionHash,
        'expiry': ?expiry,
      },
      nostr: nostr,
      timeout: const Duration(seconds: 20),
    );
    _throwOnError(response);
    final result = (response.result as Map?)?.cast<String, dynamic>() ?? {};
    return NwcInvoice(
      invoice: result['invoice'] as String? ?? '',
      paymentHash: result['payment_hash'] as String?,
      type: result['type'] as String? ?? 'incoming',
    );
  }

  Future<List<NwcTransaction>> listTransactions({
    int? from,
    int? until,
    int limit = 20,
    int offset = 0,
    bool? unpaid,
    String? type,
    required NostrService nostr,
  }) async {
    final response = await _request(
      method: 'list_transactions',
      params: {
        'from': ?from,
        'until': ?until,
        'limit': limit,
        if (offset > 0) 'offset': offset,
        'unpaid': ?unpaid,
        'type': ?type,
      },
      nostr: nostr,
      timeout: const Duration(seconds: 15),
    );
    _throwOnError(response);
    final result = (response.result as Map?)?.cast<String, dynamic>() ?? {};
    final list = (result['transactions'] as List?) ?? const [];
    return list
        .whereType<Map<String, dynamic>>()
        .map(NwcTransaction.fromJson)
        .toList();
  }

  Future<NwcTransaction?> lookupInvoice({
    String? paymentHash,
    String? invoice,
    required NostrService nostr,
  }) async {
    if (paymentHash == null && invoice == null) {
      throw ArgumentError('paymentHash or invoice is required');
    }
    final response = await _request(
      method: 'lookup_invoice',
      params: {
        'payment_hash': ?paymentHash,
        'invoice': ?invoice,
      },
      nostr: nostr,
    );
    _throwOnError(response);
    final result = (response.result as Map?)?.cast<String, dynamic>();
    if (result == null) return null;
    return NwcTransaction.fromJson(result);
  }

  // ── NIP-47 transport ───────────────────────────────────────────────

  /// Encrypt a payload to the wallet with the negotiated scheme.
  Future<String> _encryptToWallet(String plaintext) async {
    if (_encryption.startsWith('nip44')) {
      try {
        return _auth.nip44Encrypt(
          privateKey: _clientSecret!,
          peerPubkey: _walletPubkey!,
          plaintext: plaintext,
        );
      } catch (_) {
        // Wallet can't do NIP-44 — downgrade for the rest of the session.
        _encryption = 'nip04';
      }
    }
    return _auth.nip04Encrypt(
      privateKey: _clientSecret!,
      peerPubkey: _walletPubkey!,
      plaintext: plaintext,
    );
  }

  /// Decrypt a response from the wallet, trying the negotiated scheme first
  /// and falling back to the other (wallets sometimes mis-advertise).
  Future<String> _decryptFromWallet(String ciphertext) async {
    if (_encryption.startsWith('nip44')) {
      try {
        return _auth.nip44Decrypt(
          privateKey: _clientSecret!,
          peerPubkey: _walletPubkey!,
          payload: ciphertext,
        );
      } catch (_) {
        // Fall through to NIP-04.
      }
    }
    return _auth.nip04Decrypt(
      privateKey: _clientSecret!,
      peerPubkey: _walletPubkey!,
      ciphertext: ciphertext,
    );
  }

  /// Send a NIP-47 request and wait for the response.
  ///
  /// The request is a kind 23194 NIP-04-encrypted event published to the
  /// wallet's relay. The response comes back as kind 23195, encrypted to the
  /// client pubkey, with an `e` tag pointing at the request id.
  Future<NwcResponse> _request({
    required String method,
    required Map<String, dynamic> params,
    required NostrService nostr,
    Duration timeout = const Duration(seconds: 15),
  }) async {
    if (!isConnected) throw StateError('NWC not connected');

    final payload = jsonEncode({
      'method': method,
      'params': params,
    });

    // Encrypt to wallet pubkey with the negotiated scheme (NIP-44 preferred,
    // NIP-04 legacy) — modern wallets (Alby Hub, current NWC) require NIP-44.
    final encrypted = await _encryptToWallet(payload);

    // Sign with the *client* secret (not the user's main key) so the wallet
    // knows which connection this is.
    final requestEvent = _auth.signEvent(
      privateKey: _clientSecret!,
      kind: 23194,
      content: encrypted,
      tags: [
        ['p', _walletPubkey!],
      ],
    );

    // Subscribe for the response on the wallet's relays
    final responseFilter = NostrFilter(
      kinds: [23195],
      authors: [_walletPubkey!],
      pTags: [_clientPubkey!],
      since: DateTime.now().millisecondsSinceEpoch ~/ 1000 - 60,
      limit: 50,
    );

    final responseCompleter = Completer<NwcResponse>();

    // Start listening BEFORE publishing, otherwise we can miss the response.
    final sub = nostr.relayPool.subscribe(
      [responseFilter],
      relays: _relays,
    );

    StreamSubscription<NostrEvent>? listener;
    listener = sub.listen((event) async {
      // Response must reference our request id
      final eTag = event.getTag('e');
      if (eTag != requestEvent.id) return;

      try {
        final decrypted = await _decryptFromWallet(event.content);
        final json = jsonDecode(decrypted) as Map<String, dynamic>;
        if (!responseCompleter.isCompleted) {
          responseCompleter.complete(NwcResponse.fromJson(json));
        }
      } catch (_) {
        // Decryption failure means this wasn't for us
      }
    });

    try {
      // Publish the request to the wallet's relays
      nostr.relayPool.publish(requestEvent, relays: _relays);

      return await responseCompleter.future.timeout(
        timeout,
        onTimeout: () => throw TimeoutException(
            'Wallet did not respond to "$method" in time'),
      );
    } finally {
      await listener.cancel();
      // Subscription cleanup happens in relay_pool when stream subscription
      // is cancelled.
    }
  }

  void _throwOnError(NwcResponse response) {
    if (response.error != null) {
      throw NwcException(response.error!.code, response.error!.message);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  static String _derivePubkey(String privHex) {
    // Use bip340 getPublicKey via the auth service's dependency
    // We can't access bip340 directly here without a circular import, so
    // we delegate through the AuthService signEvent which derives internally.
    // However we need the pubkey for tags — compute it directly.
    return _getPubkeyFromPrivate(privHex);
  }

  /// Compute the BIP-340 x-only pubkey from a 32-byte private key.
  static String _getPubkeyFromPrivate(String privHex) {
    // secp256k1 point multiplication
    final ecParams = pc.ECDomainParameters('secp256k1');
    final privBig = BigInt.parse(privHex, radix: 16);
    final point = (ecParams.G * privBig)!;
    final x = point.x!.toBigInteger()!;
    final xBytes = _bigIntToBytes(x, 32);
    return HEX.encode(xBytes);
  }

  static List<int> _bigIntToBytes(BigInt value, int length) {
    final hex = value.toRadixString(16).padLeft(length * 2, '0');
    return HEX.decode(hex);
  }

  /// Generate a fresh NWC URI (client side). This is rarely used directly —
  /// normally the *wallet* gives us the URI. Provided for completeness.
  static String generateNewConnectionUri({
    required String walletPubkey,
    required List<String> relays,
    String? secret, // if null, one is generated
  }) {
    final s = secret ??
        HEX.encode(List<int>.generate(32, (_) => Random.secure().nextInt(256)));
    final relayParams = relays.map((r) => 'relay=${Uri.encodeComponent(r)}').join('&');
    return 'nostr+walletconnect://$walletPubkey?$relayParams&secret=$s';
  }
}

// ── Data classes ─────────────────────────────────────────────────────

class NwcUri {
  final String walletPubkey;
  final List<String> relays;
  final String secret;
  final String? lud16;

  const NwcUri({
    required this.walletPubkey,
    required this.relays,
    required this.secret,
    this.lud16,
  });
}

class NwcInfo {
  final String? alias;
  final String? color;
  final String? pubkey;
  final String? network;
  final int? blockHeight;
  final String? blockHash;
  final List<String> methods;
  final List<String> notifications;
  final String? lud16;

  const NwcInfo({
    this.alias,
    this.color,
    this.pubkey,
    this.network,
    this.blockHeight,
    this.blockHash,
    this.methods = const [],
    this.notifications = const [],
    this.lud16,
  });
}

class NwcResponse {
  final String? resultType;
  final dynamic result;
  final NwcError? error;

  const NwcResponse({this.resultType, this.result, this.error});

  factory NwcResponse.fromJson(Map<String, dynamic> json) => NwcResponse(
        resultType: json['result_type'] as String?,
        result: json['result'],
        error: json['error'] == null
            ? null
            : NwcError(
                code: (json['error'] as Map)['code'] as String? ?? 'UNKNOWN',
                message: (json['error'] as Map)['message'] as String?,
              ),
      );
}

class NwcError {
  final String code;
  final String? message;
  const NwcError({required this.code, this.message});

  @override
  String toString() => message ?? code;
}

class NwcException implements Exception {
  final String code;
  final String? message;
  const NwcException(this.code, this.message);

  @override
  String toString() => message ?? code;
}

class NwcPayResponse {
  final String preimage;
  final int? feesPaidMsat;
  const NwcPayResponse({required this.preimage, this.feesPaidMsat});
}

class NwcInvoice {
  final String invoice;
  final String? paymentHash;
  final String type; // 'incoming'
  const NwcInvoice(
      {required this.invoice, this.paymentHash, this.type = 'incoming'});
}

class NwcTransaction {
  final String type; // 'incoming' | 'outgoing'
  final String? invoice;
  final String? description;
  final String? descriptionHash;
  final String? preimage;
  final String? paymentHash;
  final int amountMsat;
  final int? feesPaidMsat;
  final int createdAt; // unix seconds
  final int? settledAt;
  final int? expiresAt;

  const NwcTransaction({
    required this.type,
    this.invoice,
    this.description,
    this.descriptionHash,
    this.preimage,
    this.paymentHash,
    required this.amountMsat,
    this.feesPaidMsat,
    required this.createdAt,
    this.settledAt,
    this.expiresAt,
  });

  int get amountSats => amountMsat ~/ 1000;
  bool get isSettled => settledAt != null;
  bool get isIncoming => type == 'incoming';

  factory NwcTransaction.fromJson(Map<String, dynamic> json) => NwcTransaction(
        type: json['type'] as String? ?? 'incoming',
        invoice: json['invoice'] as String?,
        // Free text — rendered in the transaction list.
        description: sanitizeTextOrNull(json['description'] as String?),
        descriptionHash: json['description_hash'] as String?,
        preimage: json['preimage'] as String?,
        paymentHash: json['payment_hash'] as String?,
        amountMsat: (json['amount'] as num?)?.toInt() ?? 0,
        feesPaidMsat: (json['fees_paid'] as num?)?.toInt(),
        createdAt: (json['created_at'] as num?)?.toInt() ?? 0,
        settledAt: (json['settled_at'] as num?)?.toInt(),
        expiresAt: (json['expires_at'] as num?)?.toInt(),
      );
}
