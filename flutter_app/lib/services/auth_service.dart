import 'dart:math';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:bip340/bip340.dart' as bip340;
import 'package:bech32/bech32.dart';
import 'package:hex/hex.dart';
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
