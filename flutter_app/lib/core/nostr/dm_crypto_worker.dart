import 'dart:async';
import 'dart:convert';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:hex/hex.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:pointycastle/export.dart' as pc;

/// ADR-0008 P1 — the DM crypto worker.
///
/// Decrypting DMs is the LAST big block of UI-isolate CPU: a cold-start
/// gap-fill of 50 gift-wraps is ~100 sequential NIP-44 decryptions (ECDH +
/// HKDF + ChaCha20 each), and `DmStore.prime` ran them on the UI isolate
/// (time-sliced every 4 — still janky on mid-range Android, the "chat is
/// janky after opening" freeze).
///
/// This moves ALL decrypt work to a pool of persistent worker isolates (the
/// same architecture as `RelayFrameProcessor` for relay frames). The private
/// key is passed per-call (the worker never stores it); results come back as
/// plain sendable maps. Fail-closed: any malformed/forged payload returns
/// null (never throws across the isolate boundary).
///
/// Signal/WhatsApp do exactly this: decrypt in a background handler, store
/// plaintext in the local DB, UI reads the DB. We do the same — plaintext
/// lands in `dm_messages` (device-only), the UI reads the store, and crypto
/// never touches the frame thread.
///
/// Fallback: on web (no `dart:isolate`) or spawn failure, decrypt runs
/// synchronously on the caller — the old behavior, still correct.

/// One decrypt job: the raw DM event + the recipient's private key.
class DmDecryptJob {
  final String eventId;
  final int kind; // 4 or 1059
  final String pubkey; // event author (ephemeral for NIP-17)
  final String content; // ciphertext payload
  final int createdAt;
  final List<List<String>> tags;
  final String privateKey; // the recipient's key (passed per-call, not stored)
  final String myPubkey;

  const DmDecryptJob({
    required this.eventId,
    required this.kind,
    required this.pubkey,
    required this.content,
    required this.createdAt,
    required this.tags,
    required this.privateKey,
    required this.myPubkey,
  });

  List<Object?> toWire() => [
        eventId, kind, pubkey, content, createdAt, tags, privateKey, myPubkey,
      ];

  static DmDecryptJob fromWire(List<Object?> w) => DmDecryptJob(
        eventId: w[0] as String,
        kind: w[1] as int,
        pubkey: w[2] as String,
        content: w[3] as String,
        createdAt: w[4] as int,
        tags: [
          for (final t in (w[5] as List)) [for (final v in (t as List)) '$v'],
        ],
        privateKey: w[6] as String,
        myPubkey: w[7] as String,
      );
}

/// The decrypted result (plain sendable map — mirrors `DecryptedDm`).
class DmDecryptResult {
  final String eventId;
  final String plaintext;
  final String senderPubkey;
  final String? recipientPubkey;
  final int createdAt;
  final int rumorKind;
  final List<List<String>> tags;
  final String? mimeType;

  const DmDecryptResult({
    required this.eventId,
    required this.plaintext,
    required this.senderPubkey,
    this.recipientPubkey,
    required this.createdAt,
    this.rumorKind = 14,
    this.tags = const [],
    this.mimeType,
  });

  List<Object?> toWire() => [
        eventId, plaintext, senderPubkey, recipientPubkey, createdAt,
        rumorKind, tags, mimeType,
      ];

  static DmDecryptResult fromWire(List<Object?> w) => DmDecryptResult(
        eventId: w[0] as String,
        plaintext: w[1] as String,
        senderPubkey: w[2] as String,
        recipientPubkey: w[3] as String?,
        createdAt: w[4] as int,
        rumorKind: w[5] as int,
        tags: [
          for (final t in (w[6] as List)) [for (final v in (t as List)) '$v'],
        ],
        mimeType: w[7] as String?,
      );
}

/// Pure decrypt — runs in the worker isolate AND is the sync fallback.
/// Returns null on any failure (fail-closed, never throws).
DmDecryptResult? decryptDmJob(DmDecryptJob job) {
  try {
    if (job.kind == 1059) {
      final giftWrap = NostrEvent(
        id: job.eventId,
        pubkey: job.pubkey,
        createdAt: job.createdAt,
        kind: 1059,
        tags: job.tags,
        content: job.content,
        sig: '',
      );
      // `unwrapGiftWrap` is a pure map-in/map-out function on AuthService
      // (no instance state, no Flutter plugins) — safe to call in an isolate.
      final rumor = AuthService().unwrapGiftWrap(
        recipientPrivateKey: job.privateKey,
        giftWrap: giftWrap,
      );
      final rumorPubkey = rumor['pubkey'] as String;
      final rumorContent = rumor['content'] as String;
      final rumorTs = rumor['created_at'] as int;
      final rumorTags = rumor['tags'] as List?;
      String? recipient;
      String? mime;
      if (rumorTags != null) {
        for (final tag in rumorTags) {
          if (tag is List && tag.isNotEmpty) {
            if (tag[0] == 'p' && tag.length > 1 && recipient == null) {
              recipient = tag[1] as String?;
            }
            if (tag[0] == 'm' && tag.length > 1 && mime == null) {
              mime = tag[1] as String?;
            }
          }
        }
      }
      return DmDecryptResult(
        eventId: job.eventId,
        plaintext: rumorContent,
        senderPubkey: rumorPubkey,
        recipientPubkey: recipient,
        createdAt: rumorTs,
        rumorKind: rumor['kind'] as int? ?? 14,
        tags: [
          for (final t in (rumorTags ?? const []))
            if (t is List) [for (final v in t) '$v'],
        ],
        mimeType: mime,
      );
    }
    if (job.kind == 4) {
      // Peer: if we sent it, the peer is the 'p' tag; else the author.
      final peer = job.pubkey == job.myPubkey
          ? _firstTagValue(job.tags, 'p')
          : job.pubkey;
      if (peer == null || peer.isEmpty) return null;
      final plaintext = _nip04Decrypt(job.privateKey, peer, job.content);
      return DmDecryptResult(
        eventId: job.eventId,
        plaintext: plaintext,
        senderPubkey: job.pubkey,
        recipientPubkey: _firstTagValue(job.tags, 'p'),
        createdAt: job.createdAt,
      );
    }
    return null;
  } catch (_) {
    return null; // fail-closed
  }
}

String? _firstTagValue(List<List<String>> tags, String name) {
  for (final t in tags) {
    if (t.isNotEmpty && t[0] == name && t.length > 1) return t[1];
  }
  return null;
}

/// Synchronous NIP-04 decrypt (AES-256-CBC, PKCS7) — the exact same crypto
/// as `AuthService.nip04Decrypt`, but callable inside a worker's sync wire
/// handler. Kept in lockstep with the AuthService implementation.
String _nip04Decrypt(String privateKey, String peerPubkey, String ciphertext) {
  final parts = ciphertext.split('?iv=');
  if (parts.length != 2) throw const FormatException('Invalid NIP-04 payload');
  final ctBytes = base64.decode(parts[0]);
  final ivBytes = Uint8List.fromList(base64.decode(parts[1]));
  final sharedHex = _nip04SharedSecret(privateKey, peerPubkey);
  final key = Uint8List.fromList(HEX.decode(sharedHex));
  final cipher = pc.CBCBlockCipher(pc.AESEngine())
    ..init(false, pc.ParametersWithIV(pc.KeyParameter(key), ivBytes));
  final padded = cipher.process(ctBytes);
  if (padded.isEmpty) throw const FormatException('Empty decrypted payload');
  final padLen = padded.last;
  if (padLen < 1 || padLen > 16 || padLen > padded.length) {
    throw const FormatException('Invalid PKCS7 padding');
  }
  var valid = true;
  for (var i = padded.length - padLen; i < padded.length; i++) {
    if (padded[i] != padLen) valid = false;
  }
  if (!valid) throw const FormatException('Invalid PKCS7 padding bytes');
  return utf8.decode(padded.sublist(0, padded.length - padLen));
}

/// secp256k1 ECDH shared secret (X coordinate) — mirrors
/// `AuthService._nip04SharedSecret` (duplicated here so the worker isolate
/// is self-contained and doesn't depend on AuthService's private methods).
String _nip04SharedSecret(String privateKey, String peerPubkey) {
  final ecParams = pc.ECDomainParameters('secp256k1');
  final privBig = BigInt.parse(privateKey, radix: 16);
  final peerPoint = ecParams.curve.decodePoint(_decompressPubkey(peerPubkey));
  if (peerPoint == null) {
    throw ArgumentError('Invalid peer pubkey: not a valid curve point');
  }
  final shared = (peerPoint * privBig);
  if (shared == null) throw StateError('ECDH failed');
  return shared.x!.toBigInteger()!.toRadixString(16).padLeft(64, '0');
}

/// Decompress a 32-byte X-only pubkey to a 65-byte uncompressed point.
List<int> _decompressPubkey(String xOnlyHex) {
  final x = BigInt.parse(xOnlyHex, radix: 16);
  final p = BigInt.parse(
    'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F',
    radix: 16,
  );
  final xCubed = (x * x * x) % p;
  final ySquared = (xCubed + BigInt.from(7)) % p;
  final exponent = (p + BigInt.one) ~/ BigInt.from(4);
  var y = ySquared.modPow(exponent, p);
  if (y.isOdd) y = p - y;
  final yBytes = _bigIntToBytes(y, 32);
  final xBytes = _bigIntToBytes(x, 32);
  return [0x04, ...xBytes, ...yBytes];
}

List<int> _bigIntToBytes(BigInt value, int length) {
  final hex = value.toRadixString(16).padLeft(length * 2, '0');
  return HEX.decode(hex);
}

// ─── Worker isolate plumbing ───────────────────────────────────────────────

class _Handshake {
  _Handshake(this.reply, this.handshake);
  final SendPort reply;
  final SendPort handshake;
}

void _cryptoWorkerMain(_Handshake hs) {
  final inbox = ReceivePort();
  hs.handshake.send(inbox.sendPort);
  final reply = hs.reply;
  inbox.listen((message) {
    final list = message as List;
    final seq = list[0] as int;
    final job = DmDecryptJob.fromWire((list[1] as List).cast<Object?>());
    final result = decryptDmJob(job);
    reply.send([seq, result?.toWire()]);
  });
}

/// A pool of persistent worker isolates that decrypt DMs off the UI isolate.
class DmCryptoWorker {
  DmCryptoWorker({int workerCount = defaultWorkerCount})
      : _workerCount = workerCount.clamp(1, maxWorkerCount);

  /// Shared app-wide instance (lazy — workers spawn on first decrypt).
  static final DmCryptoWorker instance = DmCryptoWorker();

  /// 2 workers: a gap-fill batch of gift-wraps decrypts in half the
  /// wall-clock, and one heavy kind-1059 never starves a kind-4 behind it.
  static const defaultWorkerCount = 2;
  static const maxWorkerCount = 4;

  final int _workerCount;
  final List<({Isolate isolate, SendPort send})> _workers = [];
  bool _starting = false;
  bool _spawnFailed = false;
  int _rr = 0;
  int _jobSeq = 0;
  final Map<int, Completer<DmDecryptResult?>> _jobs = {};

  /// Which worker owns each job (parallel to [_jobs]) — needed to fail
  /// exactly that worker's jobs when it dies (A2: a worker crash used to
  /// leave the Completer hanging, stalling `DmStore.prime`'s Future.wait
  /// forever).
  final Map<int, ({Isolate isolate, SendPort send})> _jobWorker = {};

  /// Per-job timeout: a worker that never replies must not hang `prime`
  /// forever — the job completes null (fail-closed) after this.
  static const jobTimeout = Duration(seconds: 15);
  final Map<int, Timer> _jobTimers = {};
  ReceivePort? _replyPort;

  /// Whether the pool fell back to synchronous decrypt (web / spawn failure).
  bool get isSyncFallback => _spawnFailed || _workerCount == 0;

  /// Decrypt one DM event off the UI isolate. Returns null on failure.
  Future<DmDecryptResult?> decrypt(DmDecryptJob job) {
    if (_spawnFailed || _workerCount == 0) {
      return Future.value(decryptDmJob(job));
    }
    _ensureStarted();
    final seq = _jobSeq++;
    final completer = Completer<DmDecryptResult?>();
    _jobs[seq] = completer;
    if (_workers.isEmpty) {
      // Workers still spawning: queue and flush on ready.
      _preStart.add((seq, job));
    } else {
      _dispatch(seq, job);
    }
    return completer.future;
  }

  final List<(int, DmDecryptJob)> _preStart = [];

  void _dispatch(int seq, DmDecryptJob job) {
    final w = _workers[_rr++ % _workers.length];
    _jobWorker[seq] = w;
    _jobTimers[seq] = Timer(jobTimeout, () => _timeoutJob(seq));
    w.send.send([seq, job.toWire()]);
  }

  /// A job that never got a reply: complete it null (fail-closed) so the
  /// caller's Future.wait can never hang.
  void _timeoutJob(int seq) {
    _jobTimers.remove(seq);
    _jobWorker.remove(seq);
    final completer = _jobs.remove(seq);
    completer?.complete(null);
  }

  /// A worker DIED (onExit). Fail every job it owned (completing null), then
  /// respawn a replacement so the pool stays at capacity.
  void _onWorkerExit(({Isolate isolate, SendPort send}) dead) {
    _workers.remove(dead);
    final orphanSeqs = <int>[
      for (final e in _jobWorker.entries)
        if (e.value == dead) e.key,
    ];
    for (final seq in orphanSeqs) {
      _jobTimers.remove(seq)?.cancel();
      _jobWorker.remove(seq);
      _jobs.remove(seq)?.complete(null); // fail-closed
    }
    if (!_spawnFailed) {
      _spawnWorker().then((w) {
        _workers.add(w);
      }).catchError((_) {
        if (_workers.isEmpty) _spawnFailed = true; // sync fallback
      });
    }
  }

  Future<void> _ensureStarted() async {
    if (_starting || _workers.isNotEmpty || _spawnFailed) return;
    _starting = true;
    _replyPort ??= ReceivePort()..listen(_onReply);
    try {
      final spawned = await Future.wait([
        for (var i = 0; i < _workerCount; i++) _spawnWorker(),
      ]);
      _workers.addAll(spawned);
      _flushPreStart();
    } catch (_) {
      _spawnFailed = true;
      _flushPreStart();
    } finally {
      _starting = false;
    }
  }

  Future<({Isolate isolate, SendPort send})> _spawnWorker() async {
    final handshakePort = ReceivePort();
    final inbox = Completer<SendPort>();
    handshakePort.listen((message) {
      inbox.complete(message as SendPort);
      handshakePort.close();
    });
    // onExit port: notified when the worker dies, so _onWorkerExit can fail
    // its jobs + respawn (A2 — a dead worker used to hang `prime` forever).
    final exitPort = ReceivePort();
    final isolate = await Isolate.spawn(
      _cryptoWorkerMain,
      _Handshake(_replyPort!.sendPort, handshakePort.sendPort),
      errorsAreFatal: false, // a worker crash must not kill the app
      onExit: exitPort.sendPort,
    );
    final send = await inbox.future.timeout(
      const Duration(seconds: 5),
      onTimeout: () {
        exitPort.close();
        isolate.kill(priority: Isolate.immediate);
        throw TimeoutException('crypto worker handshake timed out');
      },
    );
    final worker = (isolate: isolate, send: send);
    exitPort.listen((_) => _onWorkerExit(worker));
    return worker;
  }

  void _flushPreStart() {
    if (_preStart.isEmpty) return;
    final queued = List<(int, DmDecryptJob)>.from(_preStart);
    _preStart.clear();
    for (final (seq, job) in queued) {
      if (_spawnFailed || _workers.isEmpty) {
        _jobs.remove(seq)?.complete(decryptDmJob(job));
      } else {
        _dispatch(seq, job);
      }
    }
  }

  void _onReply(dynamic message) {
    final m = message as List;
    final seq = m[0] as int;
    _jobTimers.remove(seq)?.cancel();
    _jobWorker.remove(seq);
    final completer = _jobs.remove(seq);
    if (completer == null) return;
    final wire = m[1] as List?;
    completer.complete(
      wire == null ? null : DmDecryptResult.fromWire(wire.cast<Object?>()),
    );
  }

  /// Tear down workers + ports + timers (app-lifetime instance normally
  /// never needs this; tests construct their own and must dispose).
  void dispose() {
    for (final t in _jobTimers.values) {
      t.cancel();
    }
    _jobTimers.clear();
    _jobWorker.clear();
    for (final w in _workers) {
      w.isolate.kill(priority: Isolate.immediate);
    }
    _workers.clear();
    _replyPort?.close();
    _replyPort = null;
  }
}
