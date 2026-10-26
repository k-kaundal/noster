import 'dart:async';
import 'dart:convert';
import 'dart:isolate';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// ADR-0005 L2 hardening — the relay frame processor.
///
/// Every WebSocket frame from EVERY relay used to be JSON-decoded and
/// Schnorr-verified on the UI isolate (`RelayConnection._handleMessage`).
/// That is the "Android jank" mechanism: a page of 50 posts × 9 relays is
/// up to 450 `jsonDecode` + `bip340.verify` calls on the frame thread —
/// iOS's fast single core masks it, mid-range Android drops frames.
///
/// This is the standard architecture for high-throughput Nostr clients:
/// - **Amethyst (Kotlin)** — three-tier ingestion (PR #2769): parallel
///   Schnorr verify across CPU cores, a bounded ingest channel (cap 1024)
///   so a slow consumer applies BACKPRESSURE instead of ballooning memory.
/// - **nostrfy (Rust)** — `verify_signatures_parallel`, thread count
///   capped (≤8), FAIL-CLOSED on any worker failure.
/// - **Damus/Quartz** — verification off the WebSocket pump thread.
///
/// Here: a pool of persistent worker isolates does parse+verify; the UI
/// isolate only reassembles the (already decoded, already verified) event
/// and dispatches it. Backpressure pauses the socket subscriptions when
/// the pipeline saturates; a per-connection sequencer keeps frame ORDER
/// (an EOSE/CLOSED/OK can never overtake the EVENTs that preceded it on
/// the same socket — query correctness depends on that).
///
/// Semantics are IDENTICAL to the old inline path:
/// - same parse (`NostrEvent.fromJson` → sanitize at the source),
/// - same checks in the same order (expired → verify → dispatch),
/// - same dedup rule: verify ONCE per id, but DISPATCH every copy
///   (`EventStore.markSeenOn` provenance needs every relay's copy),
/// - forged/tampered/malformed frames are dropped silently (fail-closed).
///
/// Fallback: on web (no `dart:isolate`) or if a spawn fails, frames are
/// processed synchronously on the caller — the old behavior, still correct.

// ─── Frame results (UI-side, already parsed + verified) ───────────────────

/// Base type for a processed relay frame.
sealed class RelayFrame {
  const RelayFrame();
}

/// An `["EVENT", subId, {json}]` frame that passed expiry + signature
/// verification. [eventJson] is the DECODED map (the worker already ran
/// `jsonDecode`) — the UI runs `NostrEvent.fromJson` on it (cheap: sanitize
/// + tag wrap, no decode, no crypto).
final class EventRelayFrame extends RelayFrame {
  final String subId;
  final Map<String, dynamic> eventJson;
  const EventRelayFrame(this.subId, this.eventJson);
}

/// `["EOSE", subId]` — end of stored events for a subscription.
final class EoseRelayFrame extends RelayFrame {
  final String subId;
  const EoseRelayFrame(this.subId);
}

/// `["OK", eventId, accepted, message]` — a publish ack.
final class OkRelayFrame extends RelayFrame {
  final String eventId;
  final bool accepted;
  final String message;
  const OkRelayFrame(this.eventId, this.accepted, this.message);
}

/// `["AUTH", challenge]` — NIP-42 auth request.
final class AuthRelayFrame extends RelayFrame {
  final String challenge;
  const AuthRelayFrame(this.challenge);
}

/// `["CLOSED", subId, message]` — relay ended a subscription.
final class ClosedRelayFrame extends RelayFrame {
  final String subId;
  final String message;
  const ClosedRelayFrame(this.subId, this.message);
}

/// Frames we deliberately ignore (NOTICE, unknown types, malformed JSON,
/// failed/invalid/expired EVENTs). Carries no data — dispatch is a no-op.
final class IgnoredRelayFrame extends RelayFrame {
  const IgnoredRelayFrame();
}

// ─── Worker wire protocol (plain sendable lists) ──────────────────────────

class _Msg {
  static const event = 0, eose = 1, ok = 2, auth = 3, closed = 4, ignored = 5;
}

/// A bounded LRU of already-verified event ids (insertion-ordered
/// LinkedHashSet → `first` is the oldest). Verifying is idempotent for exact
/// event bytes, so a copy after the first skips the Schnorr entirely.
/// Public because [parseRelayFrame] takes it (the sync-fallback path and
/// tests drive it directly).
class VerifyLru {
  VerifyLru(this.cap);
  final int cap;
  final Set<String> _ids = <String>{};

  /// True if [id] was already verified (and records it if not).
  bool checkAndMark(String id) {
    if (_ids.contains(id)) return true;
    _ids.add(id);
    if (_ids.length > cap) _ids.remove(_ids.first);
    return false;
  }
}

/// Pure frame parse+verify — runs in the worker isolate AND is the sync
/// fallback on the caller isolate. Identical semantics either way.
///
/// Check order mirrors the old `_handleMessage`: expired → verify. The
/// dispatch of every copy (not just the first verified one) is preserved —
/// relay provenance (`markSeenOn`) needs every relay's copy.
RelayFrame parseRelayFrame(String raw, VerifyLru lru) {
  try {
    final data = jsonDecode(raw) as List;
    if (data.isEmpty) return const IgnoredRelayFrame();
    final type = data[0];
    switch (type) {
      case 'EVENT':
        if (data.length < 3) return const IgnoredRelayFrame();
        final subId = data[1] as String;
        final json = data[2] as Map<String, dynamic>;
        final event = NostrEvent.fromJson(json);
        if (event.isExpired) return const IgnoredRelayFrame();
        final alreadyVerified = lru.checkAndMark(event.id);
        if (!alreadyVerified && !event.isValid) {
          return const IgnoredRelayFrame(); // forged/tampered → fail closed
        }
        return EventRelayFrame(subId, json);
      case 'EOSE':
        if (data.length < 2) return const IgnoredRelayFrame();
        return EoseRelayFrame(data[1] as String);
      case 'OK':
        if (data.length < 3) return const IgnoredRelayFrame();
        return OkRelayFrame(
          data[1] as String,
          data[2] as bool,
          data.length > 3 ? '${data[3]}' : '',
        );
      case 'AUTH':
        if (data.length < 2) return const IgnoredRelayFrame();
        return AuthRelayFrame(data[1] as String);
      case 'CLOSED':
        if (data.length < 2) return const IgnoredRelayFrame();
        return ClosedRelayFrame(
          data[1] as String,
          data.length > 2 ? '${data[2]}' : '',
        );
      default: // NOTICE and anything else — ignored
        return const IgnoredRelayFrame();
    }
  } catch (_) {
    return const IgnoredRelayFrame(); // malformed → fail closed
  }
}

/// Worker isolate entry. Receives a [_Handshake]: returns its inbox
/// SendPort on `handshake`, then processes `[seq, rawString]` jobs from the
/// inbox and replies `[seq, type, ...payload]` on the shared `reply` port.
void _frameWorkerMain(_Handshake hs) {
  final inbox = ReceivePort();
  hs.handshake.send(inbox.sendPort);
  final reply = hs.reply;
  final lru = VerifyLru(RelayFrameProcessor.verifyLruCapPerWorker);
  inbox.listen((message) {
    final list = message as List;
    final seq = list[0] as int;
    final raw = list[1] as String;
    reply.send(_encode(seq, parseRelayFrame(raw, lru)));
  });
}

List<Object?> _encode(int seq, RelayFrame f) => switch (f) {
      EventRelayFrame(:final subId, :final eventJson) =>
        [seq, _Msg.event, subId, eventJson],
      EoseRelayFrame(:final subId) => [seq, _Msg.eose, subId],
      OkRelayFrame(:final eventId, :final accepted, :final message) =>
        [seq, _Msg.ok, eventId, accepted, message],
      AuthRelayFrame(:final challenge) => [seq, _Msg.auth, challenge],
      ClosedRelayFrame(:final subId, :final message) =>
        [seq, _Msg.closed, subId, message],
      IgnoredRelayFrame() => [seq, _Msg.ignored],
    };

RelayFrame _decode(List<Object?> m) {
  switch (m[1] as int) {
    case _Msg.event:
      return EventRelayFrame(m[2] as String, m[3] as Map<String, dynamic>);
    case _Msg.eose:
      return EoseRelayFrame(m[2] as String);
    case _Msg.ok:
      return OkRelayFrame(m[2] as String, m[3] as bool, (m[4] as String?) ?? '');
    case _Msg.auth:
      return AuthRelayFrame(m[2] as String);
    case _Msg.closed:
      return ClosedRelayFrame(m[2] as String, (m[3] as String?) ?? '');
    default:
      return const IgnoredRelayFrame();
  }
}

// ─── Worker handle ────────────────────────────────────────────────────────

class _Worker {
  _Worker(this.isolate, this.send);
  final Isolate isolate;
  final SendPort send;
}

/// Handshake payload sent to a freshly spawned worker: the shared reply
/// port + a one-shot port the worker uses to return its inbox SendPort.
class _Handshake {
  _Handshake(this.reply, this.handshake);
  final SendPort reply;
  final SendPort handshake;
}

// ─── Backpressure state machine (pure, unit-tested) ───────────────────────

enum BackpressureSignal { none, saturate, drain }

/// Pure watermark logic, extracted so it's deterministically testable
/// (real socket timing is too flaky to assert in a unit test). Hysteresis:
/// saturate ABOVE highWater, drain AT-or-below lowWater — the gap stops
/// flapping when the rate hovers near a single threshold.
BackpressureSignal backpressureSignal({
  required int outstanding,
  required bool saturated,
  required int highWater,
  required int lowWater,
}) {
  if (!saturated && outstanding > highWater) return BackpressureSignal.saturate;
  if (saturated && outstanding <= lowWater) return BackpressureSignal.drain;
  return BackpressureSignal.none;
}

// ─── The processor pool ───────────────────────────────────────────────────

/// A pool of persistent worker isolates that parse + verify relay frames
/// off the UI isolate, with bounded backpressure.
class RelayFrameProcessor {
  RelayFrameProcessor({int workerCount = defaultWorkerCount})
      : _workerCount = workerCount.clamp(1, maxWorkerCount);

  /// Shared app-wide instance (lazy — workers spawn on first frame).
  static final RelayFrameProcessor instance = RelayFrameProcessor();

  /// Workers default to 2: one busy relay's flood can never starve another
  /// relay's frames, and 2 cores of verify throughput drains a reconnect
  /// replay in half the wall-clock. Capped at 4 (nostrfy's ≤8-thread rule,
  /// scaled for a phone): more isolates than cores just adds scheduling
  /// churn on a thermally-constrained device.
  static const defaultWorkerCount = 2;
  static const maxWorkerCount = 4;

  /// Per-worker verified-id LRU size. With 2 workers ≈ 12k ids total —
  /// a few minutes of traffic, same intent as the old pool-level 5k LRU.
  static const verifyLruCapPerWorker = 6000;

  /// Backpressure watermarks on outstanding (submitted − completed) frames.
  /// High-water pauses the socket subscriptions (TCP flow control slows the
  /// relays); low-water resumes them. Sized like Amethyst's bounded ingest
  /// channel (1024) so a flood is throttled, never OOMed.
  static const highWater = 768;
  static const lowWater = 192;

  final int _workerCount;
  final List<_Worker> _workers = [];
  bool _starting = false;
  bool _spawnFailed = false;
  int _rr = 0; // round-robin cursor

  /// Global job sequencer + in-flight tracking.
  int _jobSeq = 0;
  final Map<int, void Function(int seq, RelayFrame frame)> _jobs = {};

  /// Which worker owns each in-flight job (parallel to [_jobs]) — needed to
  /// fail exactly that worker's jobs when it dies (A2: a worker crash used
  /// to leak the job AND latch backpressure forever).
  final Map<int, _Worker> _jobWorker = {};

  /// Per-job timeout: a worker that never replies (OOM mid-frame, an error
  /// outside the worker's `try`) must not hang its job forever — the job is
  /// completed as an [IgnoredRelayFrame] after this, decrementing
  /// [_outstanding] so backpressure can never latch.
  static const jobTimeout = Duration(seconds: 15);
  final Map<int, Timer> _jobTimers = {};

  /// Backpressure state.
  int _outstanding = 0;
  bool _saturated = false;
  final _saturatedCtl = StreamController<void>.broadcast();
  final _drainedCtl = StreamController<void>.broadcast();

  /// Fires once when the pipeline saturates (outstanding > [highWater]).
  Stream<void> get onSaturated => _saturatedCtl.stream;

  /// Fires when a saturated pipeline drains below [lowWater].
  Stream<void> get onDrained => _drainedCtl.stream;

  /// Current in-flight frame count (diagnostics / tests).
  int get outstanding => _outstanding;

  /// Whether the pool fell back to synchronous processing (web / spawn
  /// failure). Exposed for diagnostics.
  bool get isSyncFallback => _spawnFailed || _workerCount == 0;

  /// One shared reply port for all workers (keeps the protocol simple; the
  /// seq id routes the result back to its per-connection handler).
  ReceivePort? _replyPort;

  /// Submit one raw WebSocket frame. [onResult] is called with ([seq],
  /// frame) where [seq] is a monotonically increasing job id — callers use
  /// it to restore per-connection order (see [FrameSequencer]). Results may
  /// complete OUT OF ORDER across workers.
  void submit(String raw, void Function(int seq, RelayFrame frame) onResult) {
    final seq = _jobSeq++;
    _jobs[seq] = onResult;
    _trackOutstanding(1);

    // Sync fallback (web / spawn failure): process inline, still correct.
    if (_spawnFailed || _workerCount == 0) {
      _syncFallback ??= VerifyLru(verifyLruCapPerWorker);
      _deliver(seq, parseRelayFrame(raw, _syncFallback!));
      return;
    }

    _ensureStarted();
    if (_workers.isEmpty) {
      // Workers still spawning: queue onto a small pre-start buffer that
      // drains when the first worker is ready. Bounded by backpressure
      // upstream, so this never grows unboundedly.
      _preStart.add((seq, raw));
      return;
    }
    _dispatch(seq, raw);
  }

  VerifyLru? _syncFallback;
  final List<(int, String)> _preStart = [];

  void _dispatch(int seq, String raw) {
    final w = _workers[_rr++ % _workers.length];
    _jobWorker[seq] = w;
    _jobTimers[seq] = Timer(jobTimeout, () => _timeoutJob(seq));
    w.send.send([seq, raw, _replyPort!.sendPort]);
  }

  /// A job that never got a reply: complete it as ignored (fail-closed) and
  /// decrement outstanding — backpressure can never latch on a hung job.
  void _timeoutJob(int seq) {
    if (!_jobs.containsKey(seq)) return; // already completed normally
    _jobTimers.remove(seq);
    _jobWorker.remove(seq);
    _deliver(seq, const IgnoredRelayFrame());
  }

  /// A worker DIED (onExit). Fail every job it owned (so their completions
  /// fire + outstanding decrements), remove the dead worker, and respawn a
  /// replacement so the pool stays at full capacity.
  void _onWorkerExit(_Worker dead) {
    _workers.remove(dead);
    final orphanSeqs = <int>[
      for (final e in _jobWorker.entries)
        if (e.value == dead) e.key,
    ];
    for (final seq in orphanSeqs) {
      _jobTimers.remove(seq)?.cancel();
      _jobWorker.remove(seq);
      _deliver(seq, const IgnoredRelayFrame()); // fail-closed
    }
    // Respawn a replacement worker (best-effort — the pool degrades to
    // fewer workers if the respawn fails, still correct via round-robin
    // on the survivors + the sync fallback for _workers.isEmpty).
    if (!_spawnFailed) {
      _spawnWorker().then((w) {
        _workers.add(w);
      }).catchError((_) {
        // Respawn failed — run degraded; if NO workers remain, fall back to
        // sync so frames still process (the old inline behavior).
        if (_workers.isEmpty) _spawnFailed = true;
      });
    }
  }

  Future<void> _ensureStarted() async {
    if (_starting || _workers.isNotEmpty || _spawnFailed) return;
    _starting = true;
    _replyPort ??= ReceivePort()..listen(_onReply);
    try {
      // Spawn all workers CONCURRENTLY, then flush the pre-start buffer.
      final spawned = await Future.wait([
        for (var i = 0; i < _workerCount; i++) _spawnWorker(),
      ]);
      _workers.addAll(spawned);
      _flushPreStart();
    } catch (_) {
      // Spawn failed (OOM, platform restriction): fail over to synchronous
      // processing — the old behavior, still correct, just not off-thread.
      _spawnFailed = true;
      _flushPreStart();
    } finally {
      _starting = false;
    }
  }

  Future<_Worker> _spawnWorker() async {
    final handshakePort = ReceivePort();
    final inbox = Completer<SendPort>();
    handshakePort.listen((message) {
      inbox.complete(message as SendPort);
      handshakePort.close();
    });
    // onExit port: the runtime notifies us when the worker isolate dies, so
    // _onWorkerExit can fail its jobs + respawn (A2 — a dead worker used to
    // leak its jobs and latch backpressure forever).
    final exitPort = ReceivePort();
    final isolate = await Isolate.spawn(
      _frameWorkerMain,
      _Handshake(_replyPort!.sendPort, handshakePort.sendPort),
      errorsAreFatal: false, // a worker crash must not kill the app
      onExit: exitPort.sendPort,
    );
    final send = await inbox.future.timeout(
      const Duration(seconds: 5),
      onTimeout: () {
        exitPort.close();
        isolate.kill(priority: Isolate.immediate);
        throw TimeoutException('worker handshake timed out');
      },
    );
    final worker = _Worker(isolate, send);
    exitPort.listen((_) => _onWorkerExit(worker));
    return worker;
  }

  /// Process any frames submitted while workers were still spawning.
  void _flushPreStart() {
    if (_preStart.isEmpty) return;
    final queued = List<(int, String)>.from(_preStart);
    _preStart.clear();
    for (final (seq, raw) in queued) {
      if (_spawnFailed || _workers.isEmpty) {
        _syncFallback ??= VerifyLru(verifyLruCapPerWorker);
        _deliver(seq, parseRelayFrame(raw, _syncFallback!));
      } else {
        _dispatch(seq, raw);
      }
    }
  }

  void _onReply(dynamic message) {
    final m = message as List;
    final seq = m[0] as int;
    _jobTimers.remove(seq)?.cancel();
    _jobWorker.remove(seq);
    final handler = _jobs.remove(seq);
    _trackOutstanding(-1);
    handler?.call(seq, _decode(m.cast<Object?>()));
  }

  void _trackOutstanding(int delta) {
    _outstanding += delta;
    final signal = backpressureSignal(
      outstanding: _outstanding,
      saturated: _saturated,
      highWater: highWater,
      lowWater: lowWater,
    );
    switch (signal) {
      case BackpressureSignal.saturate:
        _saturated = true;
        _saturatedCtl.add(null);
      case BackpressureSignal.drain:
        _saturated = false;
        _drainedCtl.add(null);
      case BackpressureSignal.none:
        break;
    }
  }

  void _deliver(int seq, RelayFrame frame) {
    _jobTimers.remove(seq)?.cancel();
    _jobWorker.remove(seq);
    final handler = _jobs.remove(seq);
    _trackOutstanding(-1);
    handler?.call(seq, frame);
  }

  /// Tear down all workers + ports + timers. App-lifetime instance normally
  /// never needs this; tests construct their own instances and must dispose.
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
    _saturatedCtl.close();
    _drainedCtl.close();
  }
}

/// Per-connection frame sequencer: restores the socket's frame ORDER after
/// the worker pool completes frames out of order. An EOSE/CLOSED/OK can
/// never overtake the EVENTs that preceded it on the same socket — the
/// query path unsubscribes on EOSE, so reordering would silently drop
/// events (correctness, not just cosmetics).
///
/// **Epoch guard (A1)**: [reset] bumps an epoch. A frame submitted to the
/// shared worker pool just before the socket died completes a few ms AFTER
/// the reset — its completion must NOT be dispatched into the new socket's
/// stream (a dead relay's EOSE overtaking the new socket's EVENTs, or a
/// stale seq colliding with a live one). Each completion carries the epoch
/// it was submitted under; a mismatched epoch is dropped on arrival.
class FrameSequencer {
  FrameSequencer(this._dispatch);
  final void Function(RelayFrame frame) _dispatch;

  int _submitSeq = 0;
  int _nextSeq = 0;
  int _epoch = 0;
  final Map<int, RelayFrame> _buffer = {};

  /// Submit a raw frame to [processor]; the sequenced dispatch happens
  /// in-order via the callback given at construction.
  void submit(RelayFrameProcessor processor, String raw) {
    final seq = _submitSeq++;
    final epoch = _epoch; // capture: this frame belongs to the CURRENT epoch
    processor.submit(raw, (jobSeq, frame) {
      // jobSeq is the pool's global id; our LOCAL seq is what orders this
      // connection's frames. A completion from a PREVIOUS epoch (the dead
      // socket) is dropped — it can never corrupt the new order.
      if (epoch != _epoch) return;
      _buffer[seq] = frame;
      _drain();
    });
  }

  void _drain() {
    var frame = _buffer.remove(_nextSeq);
    while (frame != null) {
      _nextSeq++;
      _dispatch(frame);
      frame = _buffer.remove(_nextSeq);
    }
  }

  /// Reset for a fresh socket (reconnect): bump the epoch so any in-flight
  /// completions from the DEAD socket (submitted under the old epoch) are
  /// dropped on arrival — they can never corrupt the new socket's order.
  void reset() {
    _epoch++;
    _submitSeq = 0;
    _nextSeq = 0;
    _buffer.clear();
  }
}
