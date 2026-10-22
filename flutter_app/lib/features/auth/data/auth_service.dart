import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:bech32/bech32.dart';
import 'package:bip340/bip340.dart' as bip340;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:hex/hex.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:pointycastle/export.dart' as pc;

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
  }) => AuthState(
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
  static const _profileKey = 'nostr_profile';

  final _bech32 = const Bech32Codec();

  /// Restore stored auth. Never throws — returns logged-out state on failure.
  Future<AuthState> getStoredAuth() async {
    try {
      final privKey = await _store
          .read(key: _privKeyKey)
          .timeout(const Duration(seconds: 3), onTimeout: () => null);
      final pubKey = await _store
          .read(key: _pubKeyKey)
          .timeout(const Duration(seconds: 3), onTimeout: () => null);
      final readOnly = await _store
          .read(key: _readOnlyKey)
          .timeout(const Duration(seconds: 3), onTimeout: () => null);

      // Restore the locally-saved profile so the UI shows name/avatar
      // immediately — before any relay round-trip. Without this, a cold
      // start shows an empty profile until relays respond (and if relays
      // are slow, the profile looks "lost").
      final cachedProfile = await _readStoredProfile();

      if (privKey != null && pubKey != null) {
        return AuthState(
          pubkey: pubKey,
          privateKey: privKey,
          isLoggedIn: true,
          profile: cachedProfile,
        );
      }
      if (readOnly != null) {
        return AuthState(
          pubkey: readOnly,
          isLoggedIn: true,
          isReadOnly: true,
          profile: cachedProfile,
        );
      }
    } catch (_) {
      // Storage unavailable — return logged out
    }
    return const AuthState();
  }

  /// Persist the user's profile locally (secure storage) so it survives
  /// app restarts. Called whenever we have a fresh profile.
  Future<void> saveStoredProfile(NostrProfile profile) async {
    try {
      await _store.write(
        key: _profileKey,
        value: jsonEncode(profile.toJson()),
      );
    } catch (_) {}
  }

  Future<NostrProfile?> _readStoredProfile() async {
    try {
      final raw = await _store
          .read(key: _profileKey)
          .timeout(const Duration(seconds: 3), onTimeout: () => null);
      if (raw == null || raw.isEmpty) return null;
      return NostrProfile.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  /// Login with nsec1... private key.
  Future<AuthState> loginWithNsec(String nsec) async {
    final privKeyHex = decodeNsec(nsec.trim());
    final pubKeyHex = bip340.getPublicKey(privKeyHex);
    await _saveKeys(privKeyHex, pubKeyHex);
    return AuthState(
      pubkey: pubKeyHex,
      privateKey: privKeyHex,
      isLoggedIn: true,
    );
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
    return AuthState(
      pubkey: pubKeyHex,
      privateKey: privKeyHex,
      isLoggedIn: true,
    );
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
      id: id,
      pubkey: pubkey,
      createdAt: now,
      kind: kind,
      tags: tags,
      content: content,
      sig: sig,
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
    // Validate inputs — fail with a clear error instead of "could not parse
    // BigInt" if we were handed an npub or other non-hex string.
    if (privateKey.length != 64 ||
        !RegExp(r'^[0-9a-fA-F]+$').hasMatch(privateKey)) {
      throw ArgumentError(
        'Invalid private key format (expected 64-char hex)',
      );
    }
    if (peerPubkey.length != 64 ||
        !RegExp(r'^[0-9a-fA-F]+$').hasMatch(peerPubkey)) {
      throw ArgumentError(
        'Invalid peer pubkey format (expected 64-char hex, got '
        '"${peerPubkey.length > 20 ? '${peerPubkey.substring(0, 20)}…' : peerPubkey}")',
      );
    }

    // secp256k1 ECDH: multiply peer's point by my scalar, take X coordinate
    final ecParams = pc.ECDomainParameters('secp256k1');
    final privBig = BigInt.parse(privateKey, radix: 16);
    // Decompress the peer's public key (32-byte X-only → full point)
    final peerPubBytes = _decompressPubkey(peerPubkey);
    final peerPoint = ecParams.curve.decodePoint(peerPubBytes);
    if (peerPoint == null) {
      throw ArgumentError('Invalid peer pubkey: not a valid curve point');
    }
    final shared = (peerPoint * privBig);
    if (shared == null) {
      throw StateError('ECDH failed');
    }
    final x = shared.x!.toBigInteger()!;
    final xHex = x.toRadixString(16).padLeft(64, '0');
    return xHex;
  }

  /// Decompress a 32-byte X-only pubkey to a 65-byte uncompressed point.
  List<int> _decompressPubkey(String xOnlyHex) {
    final x = BigInt.parse(xOnlyHex, radix: 16);
    final p = BigInt.parse(
      'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F',
      radix: 16,
    );
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
      List<int>.generate(16, (_) => Random.secure().nextInt(256)),
    );
    final cipher = pc.CBCBlockCipher(pc.AESEngine())
      ..init(true, pc.ParametersWithIV(pc.KeyParameter(key), ivBytes));
    // PKCS7 pad
    final plainBytes = utf8.encode(plaintext);
    final padLen = 16 - (plainBytes.length % 16);
    final padded = Uint8List.fromList([
      ...plainBytes,
      ...List.filled(padLen, padLen),
    ]);
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
    if (parts.length != 2) {
      throw const FormatException('Invalid NIP-04 payload');
    }
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
      List<int>.generate(16, (_) => Random.secure().nextInt(256)),
    );
    final cipher = pc.CBCBlockCipher(pc.AESEngine())
      ..init(true, pc.ParametersWithIV(pc.KeyParameter(key), ivBytes));
    final plainBytes = utf8.encode(plaintext);
    final padLen = 16 - (plainBytes.length % 16);
    final padded = Uint8List.fromList([
      ...plainBytes,
      ...List.filled(padLen, padLen),
    ]);
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

  // ── NIP-44 (v2) Encryption ───────────────────────────────────────
  //
  // Used by NIP-17 gift-wrapped DMs (kind 1059). Spec:
  // https://github.com/nostr-protocol/nips/blob/master/44.md

  /// HKDF-Extract (RFC 5869) with SHA-256.
  List<int> _hkdfExtract(List<int> salt, List<int> ikm) {
    final hmac = pc.HMac(pc.SHA256Digest(), 64)
      ..init(pc.KeyParameter(Uint8List.fromList(salt)));
    return hmac.process(Uint8List.fromList(ikm));
  }

  /// HKDF-Expand (RFC 5869) with SHA-256.
  List<int> _hkdfExpand(List<int> prk, List<int> info, int length) {
    final hmac = pc.HMac(pc.SHA256Digest(), 64);
    final result = <int>[];
    var t = <int>[];
    var i = 1;
    while (result.length < length) {
      hmac.init(pc.KeyParameter(Uint8List.fromList(prk)));
      hmac.update(Uint8List.fromList(t), 0, t.length);
      hmac.update(Uint8List.fromList(info), 0, info.length);
      hmac.updateByte(i);
      t = hmac.process(Uint8List(0));
      result.addAll(t);
      i++;
    }
    return result.sublist(0, length);
  }

  /// NIP-44 conversation key: HKDF(ECDH(shared_x), salt='nip44-v2') → 32 bytes.
  List<int> _nip44ConversationKey(String privateKey, String peerPubkey) {
    final sharedXHex = _nip04SharedSecret(privateKey, peerPubkey);
    final sharedX = HEX.decode(sharedXHex);
    return _hkdfExtract(utf8.encode('nip44-v2'), sharedX);
  }

  /// NIP-44 v2 decrypt.
  ///
  /// Payload format (base64):
  ///   version(1) || nonce(32) || ciphertext || mac(32)
  ///
  /// Keys derived via HKDF(conversationKey, info=nonce, L=76):
  ///   chacha_key(32) || chacha_nonce(12) || hmac_key(32)
  String nip44Decrypt({
    required String privateKey,
    required String peerPubkey,
    required String payload,
  }) {
    try {
      final data = base64.decode(payload);
      if (data.length < 1 + 32 + 32) {
        throw const FormatException('Payload too short');
      }
      if (data[0] != 2) {
        throw const FormatException('Unsupported NIP-44 version');
      }

      final nonce = data.sublist(1, 33);
      final mac = data.sublist(data.length - 32);
      final ciphertext = data.sublist(33, data.length - 32);

      final conversationKey = _nip44ConversationKey(privateKey, peerPubkey);
      final keys = _hkdfExpand(conversationKey, nonce, 76);
      final chachaKey = keys.sublist(0, 32);
      final chachaNonce = keys.sublist(32, 44);
      final hmacKey = keys.sublist(44, 76);

      // Verify MAC: HMAC-SHA256(hmac_key, nonce || ciphertext)
      final hmac = pc.HMac(pc.SHA256Digest(), 64)
        ..init(pc.KeyParameter(Uint8List.fromList(hmacKey)));
      hmac.update(Uint8List.fromList(nonce), 0, nonce.length);
      hmac.update(Uint8List.fromList(ciphertext), 0, ciphertext.length);
      final computedMac = hmac.process(Uint8List(0));

      var macOk = true;
      for (var i = 0; i < 32; i++) {
        if (mac[i] != computedMac[i]) macOk = false;
      }
      if (!macOk) throw const FormatException('Invalid MAC');

      // Decrypt with ChaCha20 (12-byte nonce, counter starts at 0)
      final plaintextPadded = _chacha20(
        chachaKey,
        chachaNonce,
        Uint8List.fromList(ciphertext),
      );

      // Parse NIP-44 padding: 2-byte big-endian length prefix, then plaintext,
      // then zero-padding to a bucket size.
      if (plaintextPadded.length < 2) {
        throw const FormatException('Padded plaintext too short');
      }
      final plaintextLen = (plaintextPadded[0] << 8) | plaintextPadded[1];
      if (plaintextLen < 1 || plaintextLen > plaintextPadded.length - 2) {
        throw const FormatException('Invalid padded length');
      }
      final plaintext = plaintextPadded.sublist(2, 2 + plaintextLen);
      // Verify remaining bytes are all zero
      for (var i = 2 + plaintextLen; i < plaintextPadded.length; i++) {
        if (plaintextPadded[i] != 0) {
          throw const FormatException('Non-zero padding');
        }
      }
      return utf8.decode(plaintext);
    } catch (e) {
      throw FormatException('NIP-44 decrypt failed: $e');
    }
  }

  /// Minimal ChaCha20 (RFC 8439) — 20 rounds, 32-byte key, 12-byte nonce.
  /// PointyCastle's ChaCha7539Engine works but this keeps it explicit.
  Uint8List _chacha20(List<int> key, List<int> nonce, Uint8List input) {
    final engine = pc.ChaCha7539Engine();
    engine.init(
      false, // decrypt (same operation as encrypt for stream cipher)
      pc.ParametersWithIV(
        pc.KeyParameter(Uint8List.fromList(key)),
        Uint8List.fromList(nonce),
      ),
    );
    return engine.process(input);
  }

  /// NIP-44 v2 encrypt.
  String nip44Encrypt({
    required String privateKey,
    required String peerPubkey,
    required String plaintext,
  }) {
    final conversationKey = _nip44ConversationKey(privateKey, peerPubkey);
    final nonce = List<int>.generate(32, (_) => Random.secure().nextInt(256));
    final keys = _hkdfExpand(conversationKey, nonce, 76);
    final chachaKey = keys.sublist(0, 32);
    final chachaNonce = keys.sublist(32, 44);
    final hmacKey = keys.sublist(44, 76);

    final plainBytes = utf8.encode(plaintext);
    if (plainBytes.length > 65535) {
      throw ArgumentError('Plaintext too long (max 65535 bytes)');
    }
    final padded = _nip44Pad(plainBytes);

    // Encrypt with ChaCha20
    final engine = pc.ChaCha7539Engine();
    engine.init(
      true,
      pc.ParametersWithIV(
        pc.KeyParameter(Uint8List.fromList(chachaKey)),
        Uint8List.fromList(chachaNonce),
      ),
    );
    final ciphertext = engine.process(padded);

    // MAC: HMAC-SHA256(hmac_key, nonce || ciphertext)
    final hmac = pc.HMac(pc.SHA256Digest(), 64)
      ..init(pc.KeyParameter(Uint8List.fromList(hmacKey)));
    hmac.update(Uint8List.fromList(nonce), 0, nonce.length);
    hmac.update(ciphertext, 0, ciphertext.length);
    final mac = hmac.process(Uint8List(0));

    final payload = [2, ...nonce, ...ciphertext, ...mac];
    return base64.encode(payload);
  }

  /// NIP-44 padding scheme: 2-byte length prefix + plaintext + zero-padding
  /// to the next bucket boundary.
  Uint8List _nip44Pad(List<int> plaintext) {
    final len = plaintext.length;
    if (len < 1 || len > 65535) {
      throw ArgumentError('Invalid plaintext length');
    }
    final chunk = _nip44PaddingBucket(len);
    final total = 2 + chunk;
    final out = Uint8List(total);
    out[0] = (len >> 8) & 0xff;
    out[1] = len & 0xff;
    out.setRange(2, 2 + len, plaintext);
    // rest is zero
    return out;
  }

  int _nip44PaddingBucket(int len) {
    if (len <= 32) return 32;
    if (len <= 64) return 64;
    if (len <= 128) return 128;
    if (len <= 256) return 256;
    if (len <= 512) return 512;
    if (len <= 1024) return 1024;
    if (len <= 2048) return 2048;
    if (len <= 4096) return 4096;
    if (len <= 8192) return 8192;
    if (len <= 16384) return 16384;
    if (len <= 32768) return 32768;
    return 65535;
  }

  /// Generate a random one-off secp256k1 keypair (for NIP-17 seals/gifts).
  ({String priv, String pub}) generateEphemeralKeypair() {
    final priv = _generatePrivKey();
    final pub = bip340.getPublicKey(priv);
    return (priv: priv, pub: pub);
  }

  /// Sign a NIP-17 gift-wrap event (kind 1059) for a sealed rumor.
  ///
  /// Flow: rumor → seal(kind 13, signed by sender) → gift wrap(kind 1059,
  /// signed by random key, encrypted to recipient).
  ///
  /// Per NIP-17, TWO gift wraps are produced for every DM:
  ///  1. one for the recipient
  ///  2. one for the sender (so the sender's own clients can decrypt and
  ///     display their own message — Amethyst, 0xchat, Damus all do this)
  ///
  /// The sender's copy is critical for cross-platform compatibility: without
  /// it, the sender can never re-fetch their own message from relays (the
  /// gift wrap is encrypted to the recipient, and the ephemeral key is
  /// discarded).
  List<NostrEvent> signGiftWrap({
    required String senderPrivateKey,
    required String senderPubkey,
    required String recipientPubkey,
    required String plaintext,
    int kind = 14,
    String? replyToId,
    String? subject,
    List<List<String>> extraTags = const [],
    int? expiration,
  }) {
    // 1. Build the rumor (unsigned, sender's real pubkey).
    //    Rumors are NOT signed — they get their authenticity from the seal.
    //    NIP-17: kind 14 chat, kind 15 file, kind 7 reaction are all valid
    //    rumor kinds. Replies use an 'e' tag to the parent rumor.
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    // Randomize timestamp ±2 days for privacy
    final randomTs = now - Random.secure().nextInt(172800);
    final rumor = {
      'pubkey': senderPubkey,
      'created_at': randomTs,
      'kind': kind,
      'tags': [
        ['p', recipientPubkey],
        if (replyToId != null) ['e', replyToId],
        if (subject != null && subject.isNotEmpty) ['subject', subject],
        ...extraTags,
        if (expiration != null) ['expiration', '$expiration'],
      ],
      'content': plaintext,
    };
    final rumorJson = jsonEncode(rumor);

    // 2. Seal: kind 13, NIP-44 encrypted sender → wrap target, signed by
    //    sender. Per NIP-17 each gift wrap (recipient copy + sender copy)
    //    contains its OWN seal encrypted to THAT wrap's target — the sender
    //    copy must be sealed sender→sender, otherwise the sender can't
    //    decrypt their own message (this was the "unable to decrypt" bug).
    //    Seal timestamps are randomized per NIP-17 so the real send time
    //    doesn't leak through the wrap's encryption.
    final giftWraps = <NostrEvent>[];
    for (final targetPubkey in [recipientPubkey, senderPubkey]) {
      final sealedContent = nip44Encrypt(
        privateKey: senderPrivateKey,
        peerPubkey: targetPubkey,
        plaintext: rumorJson,
      );
      final sealTs = now - Random.secure().nextInt(172800);
      final sealId = NostrEvent.computeId(
        senderPubkey,
        sealTs,
        13,
        const [],
        sealedContent,
      );
      final sealSig = bip340.sign(senderPrivateKey, sealId, randomHex(32));
      final seal = NostrEvent(
        id: sealId,
        pubkey: senderPubkey,
        createdAt: sealTs,
        kind: 13,
        tags: const [],
        content: sealedContent,
        sig: sealSig,
      );
      final sealJson = jsonEncode(seal.toJson());

      // 3. Gift wrap: kind 1059, NIP-44 encrypted ephemeral → wrap target,
      //    signed by random ephemeral key (metadata privacy).
      final ephemeral = generateEphemeralKeypair();
      final giftContent = nip44Encrypt(
        privateKey: ephemeral.priv,
        peerPubkey: targetPubkey,
        plaintext: sealJson,
      );
      final giftTs = now - Random.secure().nextInt(172800);
      final giftTags = [
        ['p', targetPubkey],
        if (expiration != null) ['expiration', '$expiration'],
      ];
      final giftId = NostrEvent.computeId(
        ephemeral.pub,
        giftTs,
        1059,
        giftTags,
        giftContent,
      );
      final giftSig = bip340.sign(ephemeral.priv, giftId, randomHex(32));
      giftWraps.add(NostrEvent(
        id: giftId,
        pubkey: ephemeral.pub,
        createdAt: giftTs,
        kind: 1059,
        tags: giftTags,
        content: giftContent,
        sig: giftSig,
      ));
    }
    return giftWraps;
  }

  /// Unwrap a NIP-17 gift-wrap event (kind 1059).
  ///
  /// Returns the inner rumor as a Map with keys: pubkey, created_at, kind,
  /// tags, content. Throws on failure.
  Map<String, dynamic> unwrapGiftWrap({
    required String recipientPrivateKey,
    required NostrEvent giftWrap,
  }) {
    if (giftWrap.kind != 1059) {
      throw ArgumentError('Expected kind 1059, got ${giftWrap.kind}');
    }

    // 1. Decrypt gift wrap → seal (kind 13)
    final sealJson = nip44Decrypt(
      privateKey: recipientPrivateKey,
      peerPubkey: giftWrap.pubkey, // ephemeral key of sender
      payload: giftWrap.content,
    );
    final sealMap = jsonDecode(sealJson) as Map<String, dynamic>;
    final seal = NostrEvent.fromJson(sealMap);
    if (seal.kind != 13) {
      throw const FormatException('Inner event is not a kind 13 seal');
    }

    // 2. Decrypt seal → rumor (unsigned kind 14)
    final rumorJson = nip44Decrypt(
      privateKey: recipientPrivateKey,
      peerPubkey: seal.pubkey, // real sender
      payload: seal.content,
    );
    final rumorMap = jsonDecode(rumorJson) as Map<String, dynamic>;
    // NIP-17: valid rumor kinds are 14 (chat), 15 (file), 7 (reaction).
    final rumorKind = rumorMap['kind'] as int;
    if (rumorKind != 14 && rumorKind != 15 && rumorKind != 7) {
      throw FormatException('Inner rumor is not a chat rumor (kind $rumorKind)');
    }
    // Verify the rumor pubkey matches the seal pubkey (authenticity check)
    if (rumorMap['pubkey'] != seal.pubkey) {
      throw const FormatException('Rumor pubkey does not match seal pubkey');
    }
    return rumorMap;
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

  String encodeNpub(String hexPubkey) => _bech32.encode(
    Bech32('npub', _convertBits(HEX.decode(hexPubkey), 8, 5, true)),
    90,
  );

  String encodeNsec(String hexPrivkey) => _bech32.encode(
    Bech32('nsec', _convertBits(HEX.decode(hexPrivkey), 8, 5, true)),
    90,
  );

  String encodeNote(String hexId) => _bech32.encode(
    Bech32('note', _convertBits(HEX.decode(hexId), 8, 5, true)),
    90,
  );

  /// Encode an addressable event coordinate as naddr1… (NIP-19 TLV).
  ///
  /// [identifier] is the 'd' tag value, [pubkey] is the author hex pubkey,
  /// [kind] is the event kind. Optionally include relay hints.
  String encodeNaddr({
    required String identifier,
    required String pubkey,
    required int kind,
    List<String> relays = const [],
  }) {
    final tlv = <int>[
      // Type 0: identifier (d tag)
      0, identifier.length, ...utf8.encode(identifier),
      // Type 2: author pubkey (32 bytes)
      2, 32, ...HEX.decode(pubkey),
      // Type 3: kind (4 bytes big-endian)
      3, 4,
      (kind >> 24) & 0xff,
      (kind >> 16) & 0xff,
      (kind >> 8) & 0xff,
      kind & 0xff,
      // Type 1: relays (optional, each relay is a separate TLV entry)
      for (final r in relays) ...[1, r.length, ...utf8.encode(r)],
    ];
    return _bech32.encode(
      Bech32('naddr', _convertBits(tlv, 8, 5, true)),
      // naddr can be long — bech32 spec allows up to 90 chars, but NIP-19
      // identifiers with relay hints can exceed. Use a generous limit.
      1000,
    );
  }

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
