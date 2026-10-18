import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:bip340/bip340.dart' as bip340;
import 'package:bech32/bech32.dart';
import 'package:hex/hex.dart';
import 'package:pointycastle/export.dart' as pc;
import '../models/nostr_models.dart';

/// Auth state for the current user.
class AuthState {
  final String? pubkey;
  final String? privateKey;
  final bool isLoggedIn;
  final bool isReadOnly;
  final NostrProfile? profile;

  const AuthState({
    this.pubkey,
    this.privateKey,
    this.isLoggedIn = false,
    this.isReadOnly = false,
    this.profile,
  });

  AuthState copyWith({
    String? pubkey,
    String? privateKey,
    bool? isLoggedIn,
    bool? isReadOnly,
    NostrProfile? profile,
  }) =>
      AuthState(
        pubkey: pubkey ?? this.pubkey,
        privateKey: privateKey ?? this.privateKey,
        isLoggedIn: isLoggedIn ?? this.isLoggedIn,
        isReadOnly: isReadOnly ?? this.isReadOnly,
        profile: profile ?? this.profile,
      );
}

/// Nostr authentication: key management, signing, bech32 encoding.
class AuthService {
  // Lazy — only created when first accessed (avoids plugin init issues)
  FlutterSecureStorage? _storage;
  FlutterSecureStorage get _store => _storage ??= const FlutterSecureStorage();

  static const _privKeyKey = 'nostr_privkey';
  static const _pubKeyKey = 'nostr_pubkey';
  static const _readOnlyKey = 'nostr_readonly';

  final _bech32 = const Bech32Codec();

  /// Restore stored auth. Never throws — returns logged-out state on failure.
  Future<AuthState> getStoredAuth() async {
    try {
      final privKey = await _store.read(key: _privKeyKey)
          .timeout(const Duration(seconds: 3), onTimeout: () => null);
      final pubKey = await _store.read(key: _pubKeyKey)
          .timeout(const Duration(seconds: 3), onTimeout: () => null);
      final readOnly = await _store.read(key: _readOnlyKey)
          .timeout(const Duration(seconds: 3), onTimeout: () => null);

      if (privKey != null && pubKey != null) {
        return AuthState(pubkey: pubKey, privateKey: privKey, isLoggedIn: true);
      }
      if (readOnly != null) {
        return AuthState(pubkey: readOnly, isLoggedIn: true, isReadOnly: true);
      }
    } catch (_) {
      // Storage unavailable — return logged out
    }
    return const AuthState();
  }

  /// Login with nsec1... private key.
  Future<AuthState> loginWithNsec(String nsec) async {
    final privKeyHex = decodeNsec(nsec.trim());
    final pubKeyHex = bip340.getPublicKey(privKeyHex);
    await _saveKeys(privKeyHex, pubKeyHex);
    return AuthState(pubkey: pubKeyHex, privateKey: privKeyHex, isLoggedIn: true);
  }

  /// Login with raw hex private key.
  Future<AuthState> loginWithHexKey(String hexKey) async {
    final key = hexKey.trim().toLowerCase();
    if (key.length != 64 || !RegExp(r'^[0-9a-f]+$').hasMatch(key)) {
      throw ArgumentError('Invalid private key format');
    }
    final pubKeyHex = bip340.getPublicKey(key);
    await _saveKeys(key, pubKeyHex);
    return AuthState(pubkey: pubKeyHex, privateKey: key, isLoggedIn: true);
  }

  /// Browse read-only with npub.
  Future<AuthState> loginReadOnly(String npub) async {
    final pubKeyHex = decodeNpub(npub.trim());
    try {
      await _store.delete(key: _privKeyKey);
      await _store.delete(key: _pubKeyKey);
      await _store.write(key: _readOnlyKey, value: pubKeyHex);
    } catch (_) {}
    return AuthState(pubkey: pubKeyHex, isLoggedIn: true, isReadOnly: true);
  }

  /// Generate new key pair.
  Future<AuthState> generateKeys() async {
    final privKeyHex = _generatePrivKey();
    final pubKeyHex = bip340.getPublicKey(privKeyHex);
    await _saveKeys(privKeyHex, pubKeyHex);
    return AuthState(pubkey: pubKeyHex, privateKey: privKeyHex, isLoggedIn: true);
  }

  Future<void> logout() async {
    try {
      await _store.deleteAll();
    } catch (_) {}
  }

  Future<void> _saveKeys(String privKey, String pubKey) async {
    try {
      await _store.write(key: _privKeyKey, value: privKey);
      await _store.write(key: _pubKeyKey, value: pubKey);
      await _store.delete(key: _readOnlyKey);
    } catch (_) {}
  }

  /// Sign a Nostr event (BIP-340 Schnorr).
  NostrEvent signEvent({
    required String privateKey,
    required int kind,
    required String content,
    List<List<String>> tags = const [],
    int? createdAt,
  }) {
    final pubkey = bip340.getPublicKey(privateKey);
    final now = createdAt ?? DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final id = NostrEvent.computeId(pubkey, now, kind, tags, content);
    final aux = randomHex(32);
    final sig = bip340.sign(privateKey, id, aux);
    return NostrEvent(
      id: id, pubkey: pubkey, createdAt: now,
      kind: kind, tags: tags, content: content, sig: sig,
    );
  }

  /// Sign NIP-42 relay auth event.
  NostrEvent signRelayAuth({
    required String privateKey,
    required String relayUrl,
    required String challenge,
  }) {
    return signEvent(
      privateKey: privateKey,
      kind: 22242,
      content: '',
      tags: [
        ['relay', relayUrl],
        ['challenge', challenge],
      ],
    );
  }

  // ── NIP-04 Encrypted DMs ──────────────────────────────────────────

  /// Compute shared secret for NIP-04: ECDH(privkey, pubkey) → 32-byte X coord.
  String _nip04SharedSecret(String privateKey, String peerPubkey) {
    // secp256k1 ECDH: multiply peer's point by my scalar, take X coordinate
    final ecParams = pc.ECDomainParameters('secp256k1');
    final privBig = BigInt.parse(privateKey, radix: 16);
    // Decompress the peer's public key (32-byte X-only → full point)
    final peerPubBytes = _decompressPubkey(peerPubkey);
    final peerPoint = ecParams.curve.decodePoint(peerPubBytes)!;
    final shared = (peerPoint * privBig)!;
    final x = shared.x!.toBigInteger()!;
    final xHex = x.toRadixString(16).padLeft(64, '0');
    return xHex;
  }

  /// Decompress a 32-byte X-only pubkey to a 65-byte uncompressed point.
  List<int> _decompressPubkey(String xOnlyHex) {
    final x = BigInt.parse(xOnlyHex, radix: 16);
    final p = BigInt.parse('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F', radix: 16);
    // y² = x³ + 7 (mod p)
    final xCubed = (x * x * x) % p;
    final ySquared = (xCubed + BigInt.from(7)) % p;
    // Compute y = ySquared^((p+1)/4) mod p  (p ≡ 3 mod 4)
    final exponent = (p + BigInt.one) ~/ BigInt.from(4);
    var y = ySquared.modPow(exponent, p);
    // BIP-340: use even Y
    if (y.isOdd) y = p - y;
    final yBytes = _bigIntToBytes(y, 32);
    final xBytes = _bigIntToBytes(x, 32);
    return [0x04, ...xBytes, ...yBytes];
  }

  List<int> _bigIntToBytes(BigInt value, int length) {
    final hex = value.toRadixString(16).padLeft(length * 2, '0');
    return HEX.decode(hex);
  }

  /// NIP-04 encrypt: AES-256-CBC with random IV, base64-encoded as `<ct>?iv=<iv>`.
  Future<String> nip04Encrypt({
    required String privateKey,
    required String peerPubkey,
    required String plaintext,
  }) async {
    final sharedHex = _nip04SharedSecret(privateKey, peerPubkey);
    final key = Uint8List.fromList(HEX.decode(sharedHex));
    final ivBytes = Uint8List.fromList(
        List<int>.generate(16, (_) => Random.secure().nextInt(256)));
    final cipher = pc.CBCBlockCipher(pc.AESEngine())
      ..init(true, pc.ParametersWithIV(pc.KeyParameter(key), ivBytes));
    // PKCS7 pad
    final plainBytes = utf8.encode(plaintext);
    final padLen = 16 - (plainBytes.length % 16);
    final padded = Uint8List.fromList([...plainBytes, ...List.filled(padLen, padLen)]);
    final encrypted = cipher.process(padded);
    final ctB64 = base64.encode(encrypted);
    final ivB64 = base64.encode(ivBytes);
    return '$ctB64?iv=$ivB64';
  }

  /// NIP-04 decrypt.
  Future<String> nip04Decrypt({
    required String privateKey,
    required String peerPubkey,
    required String ciphertext,
  }) async {
    final parts = ciphertext.split('?iv=');
    if (parts.length != 2) throw const FormatException('Invalid NIP-04 payload');
    final ctBytes = base64.decode(parts[0]);
    final ivBytes = Uint8List.fromList(base64.decode(parts[1]));
    final sharedHex = _nip04SharedSecret(privateKey, peerPubkey);
    final key = Uint8List.fromList(HEX.decode(sharedHex));
    final cipher = pc.CBCBlockCipher(pc.AESEngine())
      ..init(false, pc.ParametersWithIV(pc.KeyParameter(key), ivBytes));
    final padded = cipher.process(ctBytes);
    // PKCS7 unpad with validation to prevent padding oracle attacks
    if (padded.isEmpty) throw const FormatException('Empty decrypted payload');
    final padLen = padded.last;
    // Validate padLen is in valid range (1-16)
    if (padLen < 1 || padLen > 16 || padLen > padded.length) {
      throw const FormatException('Invalid PKCS7 padding');
    }
    // Verify all padding bytes equal padLen (constant-time to avoid timing attacks)
    var valid = true;
    for (var i = padded.length - padLen; i < padded.length; i++) {
      if (padded[i] != padLen) valid = false;
    }
    if (!valid) throw const FormatException('Invalid PKCS7 padding bytes');
    return utf8.decode(padded.sublist(0, padded.length - padLen));
  }

  /// Sign a NIP-04 encrypted DM event.
  NostrEvent signDmEvent({
    required String privateKey,
    required String peerPubkey,
    required String plaintext,
  }) {
    final sharedHex = _nip04SharedSecret(privateKey, peerPubkey);
    final key = Uint8List.fromList(HEX.decode(sharedHex));
    final ivBytes = Uint8List.fromList(
        List<int>.generate(16, (_) => Random.secure().nextInt(256)));
    final cipher = pc.CBCBlockCipher(pc.AESEngine())
      ..init(true, pc.ParametersWithIV(pc.KeyParameter(key), ivBytes));
    final plainBytes = utf8.encode(plaintext);
    final padLen = 16 - (plainBytes.length % 16);
    final padded = Uint8List.fromList([...plainBytes, ...List.filled(padLen, padLen)]);
    final encrypted = cipher.process(padded);
    final ctB64 = base64.encode(encrypted);
    final ivB64 = base64.encode(ivBytes);

    return signEvent(
      privateKey: privateKey,
      kind: 4,
      content: '$ctB64?iv=$ivB64',
      tags: [
        ['p', peerPubkey],
      ],
    );
  }

  // ── Bech32 encode/decode ──────────────────────────────────────────

  String decodeNsec(String nsec) {
    final decoded = _bech32.decode(nsec, nsec.length);
    return HEX.encode(_convertBits(decoded.data, 5, 8, false));
  }

  String decodeNpub(String npub) {
    final decoded = _bech32.decode(npub, npub.length);
    return HEX.encode(_convertBits(decoded.data, 5, 8, false));
  }

  String decodeNote(String note) {
    final decoded = _bech32.decode(note, note.length);
    return HEX.encode(_convertBits(decoded.data, 5, 8, false));
  }

  String encodeNpub(String hexPubkey) =>
      _bech32.encode(Bech32('npub', _convertBits(HEX.decode(hexPubkey), 8, 5, true)), 90);

  String encodeNsec(String hexPrivkey) =>
      _bech32.encode(Bech32('nsec', _convertBits(HEX.decode(hexPrivkey), 8, 5, true)), 90);

  String encodeNote(String hexId) =>
      _bech32.encode(Bech32('note', _convertBits(HEX.decode(hexId), 8, 5, true)), 90);

  String _generatePrivKey() {
    final rng = Random.secure();
    final bytes = List<int>.generate(32, (_) => rng.nextInt(256));
    return HEX.encode(bytes);
  }

  List<int> _convertBits(List<int> data, int from, int to, bool pad) {
    var acc = 0;
    var bits = 0;
    final maxv = (1 << to) - 1;
    final result = <int>[];
    for (final value in data) {
      acc = (acc << from) | value;
      bits += from;
      while (bits >= to) {
        bits -= to;
        result.add((acc >> bits) & maxv);
      }
    }
    if (pad && bits > 0) result.add((acc << (to - bits)) & maxv);
    return result;
  }
}
