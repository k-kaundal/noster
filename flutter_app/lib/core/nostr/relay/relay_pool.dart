import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show visibleForTesting;

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_frame_processor.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_health.dart';
import 'package:nostrfeed_mobile/core/relay/local_first_query.dart';
import 'package:nostrfeed_mobile/features/settings/application/relay_settings_providers.dart'
    show readRelayUrls, writeRelayUrls;
import 'package:uuid/uuid.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

enum RelayState { disconnected, connecting, connected, authRequired, error }

/// A live subscription that must be re-issued when the socket reconnects.
class _PersistentSub {
  final String id;
  final List<NostrFilter> filters;
  final StreamController<NostrEvent> controller;

  /// Newest event created_at seen on this subscription — the sliding cursor.
  /// On resubscribe we advance each filter's `since` to this so the relay
  /// only replays what arrived AFTER our newest known event, instead of
  /// re-replaying the whole frozen window (the notification-storm cause).
  int newestSeen = 0;

  _PersistentSub(this.id, this.filters, this.controller);

  /// Filters to send on (re)issue: original, but with `since` advanced to
  /// the newest event we've already received (when the filter has a since).
  ///
  /// NIP-17 gift wraps carry a randomized `created_at` up to 2 days in the
  /// past for privacy. Sliding `since` to `newestSeen` (wall-clock now)
  /// filters genuinely NEW wraps out of the resubscribe — live DMs die
  /// after the first socket reconnect. For kind-1059 filters, cap the slide
  /// at `now - 2 days` so the full backdate window is always covered.
  List<NostrFilter> effectiveFilters() {
    if (newestSeen == 0) return filters;
    final nowSec = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    return [
      for (final f in filters)
        if (f.since != null && newestSeen > f.since!)
          NostrFilter(
            ids: f.ids,
            authors: f.authors,
            kinds: f.kinds,
            tagFilters: f.tagFilters,
            // Cap the slide for NIP-17 wraps: never filter beyond the
            // 2-day backdate window, or new wraps vanish on reconnect.
            since: (f.kinds?.contains(1059) ?? false)
                ? (newestSeen > nowSec - 2 * 24 * 3600
                    ? nowSec - 2 * 24 * 3600
                    : newestSeen)
                : newestSeen,
            until: f.until,
            limit: f.limit,
            search: f.search,
          )
        else
          f,
    ];
  }
}

/// A single relay WebSocket connection with NIP-42 auth support.
class RelayConnection {
  final String url;
  WebSocketChannel? _channel;
  RelayState state = RelayState.disconnected;
  String? lastError;
  final Map<String, StreamController<NostrEvent>> _subs = {};

  /// Live subscriptions keyed by id, kept so they can be RE-ISSUED after a
  /// reconnect (sockets die on idle/background; without resubscription the
  /// app goes silent until restarted).
  final Map<String, _PersistentSub> _persistentSubs = {};
  final _uuid = const Uuid();

  /// NIP-42 auth challenge
  String? _authChallenge;

  /// REQs queued while the relay's NIP-42 AUTH handshake is in flight.
  /// Flushed by [_respondToAuth] once the relay accepts our auth event —
  /// a REQ sent before AUTH completes gets dropped by auth-required relays
  /// (strfry `restrictReadToInvolvedPubkey`), which surfaced as "DMs never
  /// load on our hub while the same account works on Damus/Primal".
  final List<(String, List<NostrFilter>)> _pendingReqsAfterAuth = [];

  /// Pending publish confirmations: eventId → completer for the relay's OK.
  final Map<String, Completer<bool>> _publishAcks = {};

  /// Callback to produce a signed auth event.
  Future<NostrEvent> Function(String challenge)? onAuthChallenge;

  final _stateController = StreamController<RelayState>.broadcast();
  Stream<RelayState> get stateStream => _stateController.stream;

  /// Track EOSE per subscription.
  final Map<String, Completer<void>> _eoseCompleters = {};

  int _reconnectAttempts = 0;
  Timer? _reconnectTimer;
  bool _intentionallyClosed = false;

  RelayConnection(this.url, {this.processor});

  /// Test seam (mirrors `EventStore.debugOpenOverride`): drive the frame
  /// dispatch + inspect the pending-auth queue without a live socket.
  /// Never use from app code — go through the socket.
  @visibleForTesting
  void debugDispatchFrame(RelayFrame frame) => _dispatchFrame(frame);

  /// Count of REQs waiting for the NIP-42 handshake (test introspection).
  @visibleForTesting
  int get debugPendingAuthReqCount => _pendingReqsAfterAuth.length;

  /// Register a persistent sub without a socket (test setup for the
  /// auth-required CLOSED re-queue path).
  @visibleForTesting
  (String, Stream<NostrEvent>) debugRegisterPersistentSub(
    List<NostrFilter> filters,
  ) {
    final id = _uuid.v4().substring(0, 8);
    final controller = StreamController<NostrEvent>.broadcast();
    _subs[id] = controller;
    _persistentSubs[id] = _PersistentSub(id, filters, controller);
    return (id, controller.stream);
  }

  /// (The old `verifiedMarker` constructor param is GONE: cross-relay
  /// verify dedup now lives in the frame processor's per-worker LRU. The
  /// pool's `markVerified`/`_verifiedIds` below are retained as a public
  /// utility but no longer gate dispatch.)

  /// ADR-0008 P3 fleet hooks — set by the owning RelayPool so it can score
  /// this relay's health WITHOUT the connection knowing the tracker exists
  /// (clean separation: connection = transport, pool = fleet management).
  /// Null for ad-hoc standalone connections.
  void Function()? onConnectSuccess;
  void Function()? onConnectFailure;
  void Function(int ms)? onEose;
  void Function()? onEventDelivered;

  /// True when the socket is usable — `connected` OR mid-AUTH-handshake
  /// (`authRequired`). Treating `authRequired` as usable lets DM queries
  /// queue their REQs (flushed when AUTH completes) instead of being
  /// skipped as "offline" — the "hub returns empty DM history" bug.
  bool get isConnected =>
      state == RelayState.connected || state == RelayState.authRequired;

  Future<void> connect() async {
    if (state == RelayState.connected) return;
    _intentionallyClosed = false;
    _setState(RelayState.connecting);

    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));
      await _channel!.ready.timeout(const Duration(seconds: 10));
      _reconnectAttempts = 0;
      _setState(RelayState.connected);
      onConnectSuccess?.call(); // fleet health: a good socket
      // Fresh socket: reset the frame sequencer so in-flight completions
      // from the DEAD socket (stale seq ids) can't corrupt the new order.
      _sequencer.reset();
      _socketSub = _channel!.stream.listen(
        _handleMessage,
        onError: _handleError,
        onDone: _handleDone,
      );
      // Re-issue any subscriptions that were live before the socket dropped.
      _resubscribeAll();
    } catch (e) {
      lastError = e.toString();
      _setState(RelayState.error);
      onConnectFailure?.call(); // fleet health: a failed socket
      _scheduleReconnect();
    }
  }

  void _setState(RelayState s) {
    state = s;
    _stateController.add(s);
  }

  void _handleError(dynamic e) {
    lastError = e.toString();
    _setState(RelayState.error);
    _scheduleReconnect();
  }

  void _handleDone() {
    _setState(RelayState.disconnected);
    // Complete all pending EOSE completers so queries don't hang
    for (final c in _eoseCompleters.values) {
      if (!c.isCompleted) c.complete();
    }
    _eoseCompleters.clear();
    // Fail any publishes waiting for an OK — the socket is gone
    for (final c in _publishAcks.values) {
      if (!c.isCompleted) c.complete(false);
    }
    _publishAcks.clear();
    if (!_intentionallyClosed) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_intentionallyClosed) return;
    _reconnectTimer?.cancel();
    final delay = Duration(
      seconds: _reconnectAttempts < 6 ? (1 << _reconnectAttempts) : 30,
    );
    _reconnectAttempts++;
    _reconnectTimer = Timer(delay, () => connect());
  }

  /// Reset the exponential backoff (used on app-resume so reconnects fire
  /// immediately instead of waiting out a long idle-built backoff).
  void resetBackoff() {
    _reconnectAttempts = 0;
    _reconnectTimer?.cancel();
  }

  /// Raw socket frame → off-isolate parse+verify pipeline. The expensive
  /// work (`jsonDecode` + Schnorr verify) happens on a worker isolate; the
  /// sequenced dispatch below runs on the UI isolate but only reassembles
  /// the already-decoded, already-verified event (no decode, no crypto).
  /// The sequencer restores per-socket frame ORDER so an EOSE/CLOSED/OK can
  /// never overtake the EVENTs that preceded it on this socket.
  late final FrameSequencer _sequencer = FrameSequencer(_dispatchFrame);
  late final RelayFrameProcessor _processor =
      processor ?? RelayFrameProcessor.instance;

  /// Optional processor override (tests); defaults to the shared pool.
  final RelayFrameProcessor? processor;

  /// The socket stream subscription — held so backpressure can pause it
  /// (TCP flow control slows the relay) when the frame pipeline saturates.
  StreamSubscription<dynamic>? _socketSub;

  void _handleMessage(dynamic raw) {
    if (raw is! String) return;
    _sequencer.submit(_processor, raw);
  }

  /// Pause reading from the socket (backpressure — the relay's send buffer
  /// and TCP window fill, throttling IT instead of our memory ballooning).
  void pauseSocket() {
    if (!(_socketSub?.isPaused ?? false)) _socketSub?.pause();
  }

  /// Resume a backpressure-paused socket.
  void resumeSocket() {
    if (_socketSub?.isPaused ?? false) _socketSub?.resume();
  }

  /// UI-isolate dispatch of an already-parsed, already-verified frame. Runs
  /// in original socket order (via the sequencer). No JSON decode, no
  /// crypto — those happened on the worker isolate.
  void _dispatchFrame(RelayFrame frame) {
    switch (frame) {
      case EventRelayFrame(:final subId, :final eventJson):
        final event = NostrEvent.fromJson(eventJson);
        // Record provenance (ADR-0005 L4): which relay delivered this
        // event — relay hints for thread/backfill fetches later. Buffered
        // in the store (no per-frame I/O). EVERY copy is dispatched (not
        // just the first verified one) precisely so provenance is complete.
        EventStore.instance.markSeenOn(event.id, url);
        onEventDelivered?.call(); // fleet health: this relay is producing
        // ADR-0008 P3 author affinity: which relays deliver this author's
        // events (outbox routing hint — publish where their content lives).
        // Buffered by the store; cheap (one UPSERT per distinct pair).
        EventStore.instance.recordAuthorRelay(event.pubkey, url);
        // Advance the sliding cursor for resubscribe — this sub's next
        // re-issue only asks for events NEWER than this one.
        final persistent = _persistentSubs[subId];
        if (persistent != null && event.createdAt > persistent.newestSeen) {
          persistent.newestSeen = event.createdAt;
        }
        _subs[subId]?.add(event);
      case EoseRelayFrame(:final subId):
        final completer = _eoseCompleters[subId];
        if (completer != null && !completer.isCompleted) {
          completer.complete();
        }
      case OkRelayFrame(:final eventId, :final accepted):
        final completer = _publishAcks.remove(eventId);
        if (completer != null && !completer.isCompleted) {
          completer.complete(accepted);
        }
        // An OK for the AUTH event (accepted) means the relay has REGISTERED
        // our pubkey — REQs that were CLOSED "auth-required" before this
        // point (their CLOSED frames raced ahead) are safe to re-issue now.
        if (accepted && _pendingReqsAfterAuth.isNotEmpty) {
          _flushPendingReqs();
        }
      case AuthRelayFrame(:final challenge):
        _authChallenge = challenge;
        _setState(RelayState.authRequired);
        _respondToAuth();
      case ClosedRelayFrame(:final subId, :final message):
        // strfry `restrictReadToInvolvedPubkey` answers any DM-kind REQ that
        // raced the NIP-42 handshake with CLOSED "auth-required" — that REQ
        // is dead, but the SUBSCRIPTION must NOT be torn down: it is exactly
        // the live DM stream (kinds 4/1059) that keeps chat realtime. Queue
        // it for re-issue once AUTH completes instead (the auth response
        // flush in _respondToAuth sends it again, this time as an
        // authenticated user the relay accepts).
        if (message.startsWith('auth-required')) {
          final persistent = _persistentSubs[subId];
          if (persistent != null) {
            // Dedupe: a repeated CLOSED for the same subId must not stack
            // duplicate REQs in the flush queue.
            if (!_pendingReqsAfterAuth.any((r) => r.$1 == subId)) {
              // effectiveFilters() keeps the NIP-17 backdate window + the
              // sliding-cursor optimization on the re-issue.
              _pendingReqsAfterAuth.add((subId, persistent.effectiveFilters()));
            }
            // Do NOT complete EOSE / close the stream — the re-issued REQ
            // (same subId, after auth) keeps delivering into it.
            return;
          }
        }
        final completer = _eoseCompleters[subId];
        if (completer != null && !completer.isCompleted) {
          completer.complete();
        }
        _subs.remove(subId)?.close();
      case IgnoredRelayFrame():
        break; // NOTICE / malformed / forged / expired — dropped upstream
    }
  }

  /// Send every REQ queued while the NIP-42 handshake was in flight. Called
  /// from [_respondToAuth] (right after the AUTH event goes out — strfry
  /// preserves socket order, so REQs sent after the AUTH are processed as an
  /// authenticated user) AND from the AUTH's OK handler (covers a CLOSED
  /// "auth-required" frame that raced in after the flush).
  void _flushPendingReqs() {
    final queued = List.of(_pendingReqsAfterAuth);
    _pendingReqsAfterAuth.clear();
    for (final (id, filters) in queued) {
      try {
        final msg = jsonEncode(['REQ', id, ...filters.map((f) => f.toJson())]);
        _channel?.sink.add(msg);
      } catch (_) {}
    }
  }

  Future<void> _respondToAuth() async {
    if (_authChallenge == null || onAuthChallenge == null) return;
    try {
      final authEvent = await onAuthChallenge!(_authChallenge!);
      _channel?.sink.add(jsonEncode(['AUTH', authEvent.toJson()]));
      _setState(RelayState.connected);
      // Flush REQs queued during the AUTH handshake — strfry processes frames
      // in socket order, so these are evaluated AFTER the relay registers our
      // auth (the "DMs never load on our hub while the same account works on
      // Damus/Primal" bug was this REQ racing the handshake).
      _flushPendingReqs();
      // Persistent subs issued pre-auth were silenced by the relay too —
      // re-issue them all as the now-authenticated user. A sub that was both
      // queued above AND registered persistent gets its REQ sent twice;
      // NIP-01 defines a duplicate REQ id as a sub RESTART (not a second
      // sub), so no event is delivered twice.
      _resubscribeAll();
    } catch (_) {}
  }

  /// Subscribe and get a stream + EOSE future.
  ///
  /// [oneShot] marks this as a query-style REQ that completes at EOSE — it is
  /// NOT registered as a persistent sub, so a reconnect does NOT re-issue it.
  /// Before this flag existed, EVERY one-shot query (feed pages, engagement
  /// batches, profile lookups) was registered persistent, so after each
  /// reconnect the relay got a burst of hundreds of stale replayed REQs — the
  /// pressure behind the hub's "too many concurrent REQs" rejections.
  ({String id, Stream<NostrEvent> stream, Future<void> eose}) subscribeWithEose(
    List<NostrFilter> filters, {
    bool oneShot = false,
  }) {
    final id = _uuid.v4().substring(0, 8);
    final controller = StreamController<NostrEvent>.broadcast();
    final eoseCompleter = Completer<void>();
    _subs[id] = controller;
    _eoseCompleters[id] = eoseCompleter;

    // Track for re-issue on reconnect (streaming subs only — one-shot
    // queries complete via EOSE and don't need persistence).
    if (!oneShot) {
      _persistentSubs[id] = _PersistentSub(id, filters, controller);
    }

    if (state == RelayState.connected) {
      final msg = jsonEncode(['REQ', id, ...filters.map((f) => f.toJson())]);
      _channel?.sink.add(msg);
      // Fleet health: time this REQ's EOSE (a fast EOSE = a healthy relay).
      final issuedAt = DateTime.now().millisecondsSinceEpoch;
      eoseCompleter.future.then((_) {
        onEose?.call(DateTime.now().millisecondsSinceEpoch - issuedAt);
      }).catchError((_) {});
    } else if (state == RelayState.authRequired) {
      // NIP-42 auth in flight — queue the REQ to fire once auth completes.
      // Without this, DM queries against auth-required relays (our hub
      // restricts kind 4/1059 reads to involved pubkeys) return empty
      // because the REQ raced the AUTH handshake.
      _pendingReqsAfterAuth.add((id, filters));
      // The EOSE completer resolves when the queued REQ's EOSE arrives
      // (the sub is already registered in _subs/_eoseCompleters above).
    } else {
      // Not connected — complete EOSE immediately so queries don't hang
      if (!eoseCompleter.isCompleted) eoseCompleter.complete();
    }

    return (id: id, stream: controller.stream, eose: eoseCompleter.future);
  }

  /// Subscribe to events. Returns (subId, eventStream).
  (String, Stream<NostrEvent>) subscribe(List<NostrFilter> filters) {
    final sub = subscribeWithEose(filters);
    return (sub.id, sub.stream);
  }

  void unsubscribe(String subId) {
    try {
      _channel?.sink.add(jsonEncode(['CLOSE', subId]));
    } catch (_) {}
    _persistentSubs.remove(subId);
    _subs.remove(subId)?.close();
    _eoseCompleters.remove(subId);
  }

  /// Re-issue all live subscriptions after a reconnect. Called when the
  /// socket comes back up — Android kills idle sockets, so without this the
  /// app receives nothing until restarted.
  void _resubscribeAll() {
    for (final sub in _persistentSubs.values) {
      try {
        // Sliding-since: only replay events NEWER than our newest seen —
        // a frozen 6h window re-replayed everything on every reconnect.
        final filters = sub.effectiveFilters();
        final msg = jsonEncode(
          ['REQ', sub.id, ...filters.map((f) => f.toJson())],
        );
        _channel?.sink.add(msg);
      } catch (_) {}
    }
  }

  /// Fire-and-forget publish (legacy). Prefer [publishWithAck] for anything
  /// the user expects to be delivered (DMs, posts).
  void publish(NostrEvent event) {
    if (state == RelayState.connected) {
      _channel?.sink.add(jsonEncode(['EVENT', event.toJson()]));
    }
  }

  /// Publish and wait for the relay's OK response.
  ///
  /// Returns true if the relay accepted the event, false if rejected, not
  /// connected, or the wait timed out.
  Future<bool> publishWithAck(
    NostrEvent event, {
    Duration timeout = const Duration(seconds: 10),
  }) async {
    // authRequired counts as usable (isConnected) but publishes must wait
    // for the AUTH handshake — a kind-1059 gift wrap sent before AUTH
    // completes gets dropped by `restrictReadToInvolvedPubkey` relays.
    if (state == RelayState.authRequired) {
      // Wait for auth to complete (bounded — the handshake is fast).
      for (var i = 0; i < 30 && state == RelayState.authRequired; i++) {
        await Future.delayed(const Duration(milliseconds: 100));
      }
    }
    if (state != RelayState.connected) return false;
    final completer = Completer<bool>();
    _publishAcks[event.id] = completer;
    try {
      _channel?.sink.add(jsonEncode(['EVENT', event.toJson()]));
    } catch (_) {
      _publishAcks.remove(event.id);
      return false;
    }
    try {
      return await completer.future.timeout(timeout, onTimeout: () => false);
    } finally {
      _publishAcks.remove(event.id);
    }
  }

  void disconnect() {
    _intentionallyClosed = true;
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    for (final s in _subs.values) {
      s.close();
    }
    _subs.clear();
    for (final c in _eoseCompleters.values) {
      if (!c.isCompleted) c.complete();
    }
    _eoseCompleters.clear();
    for (final c in _publishAcks.values) {
      if (!c.isCompleted) c.complete(false);
    }
    _publishAcks.clear();
    _setState(RelayState.disconnected);
  }
}

/// Multi-relay pool with query/publish and health tracking.
class RelayPool {
  final Map<String, RelayConnection> _relays = {};
  List<String> relayUrls;

  /// Auth signer callback — set by auth service.
  Future<NostrEvent> Function(String relayUrl, String challenge)? authHandler;

  /// The shared off-isolate frame parse+verify pipeline. All connections
  /// feed it; its backpressure signals pause/resume the sockets.
  late final RelayFrameProcessor frameProcessor;

  /// ADR-0008 P3: the fleet's tier + EWMA health scoring (persisted to
  /// `relay_health`). Drives top-K query fan-out + ad-hoc pool bounds.
  final RelayHealthTracker health = RelayHealthTracker();

  /// Ad-hoc (T3 outbox-discovery) connection pool: url → monotonic last-used
  /// sequence number. Bounded (≤ [_maxAdhocConnections]) with LRU eviction —
  /// these relays are ephemeral (per-user NIP-65 write/read relays discovered
  /// at publish/query time), so they must not accumulate one socket per
  /// contact forever.
  ///
  /// Ordering uses a monotonic counter, NOT wall-clock time: several touches
  /// inside one millisecond would otherwise tie and evict the wrong relay
  /// (the flaky-test bug). A counter is deterministic — higher = more recent.
  final Map<String, int> _adhocLastUsed = {};
  int _adhocSeq = 0;
  static const _maxAdhocConnections = 4;

  /// Mark an ad-hoc connection as used now (bump its sequence), and if the
  /// ad-hoc pool is over budget, disconnect + drop the least-recently-used
  /// one (lowest sequence). Only T3 (ad-hoc/outbox) relays are bounded —
  /// platform/user/curated relays are persistent and never evicted this way.
  void _touchAdhoc(String url) {
    if (health.tierOf(url) != DbRelayTier.adhoc) return; // only T3 is bounded
    _adhocLastUsed[url] = ++_adhocSeq;
    if (_adhocLastUsed.length <= _maxAdhocConnections) return;
    // Evict the lowest-sequence ad-hoc connection (not the one just used).
    String? lruUrl;
    var lruSeq = _adhocSeq;
    for (final e in _adhocLastUsed.entries) {
      if (e.key != url && e.value < lruSeq) {
        lruSeq = e.value;
        lruUrl = e.key;
      }
    }
    if (lruUrl != null) {
      _adhocLastUsed.remove(lruUrl);
      _relays.remove(lruUrl)?.disconnect();
    }
  }

  RelayPool({List<String>? relays, RelayFrameProcessor? frameProcessor})
      : relayUrls = List.from(relays ?? Env.defaultRelays) {
    this.frameProcessor = frameProcessor ?? RelayFrameProcessor.instance;
    // Backpressure: when the pipeline saturates (a multi-relay flood faster
    // than the workers drain), pause every socket — TCP flow control slows
    // the relays at the SOURCE instead of our memory ballooning. Resume
    // when it drains. This is the standard bounded-ingest pattern
    // (Amethyst's 1024-cap channel, nostrfy's bounded worker queue).
    this.frameProcessor.onSaturated.listen((_) {
      for (final c in _relays.values) {
        c.pauseSocket();
      }
    });
    this.frameProcessor.onDrained.listen((_) {
      for (final c in _relays.values) {
        c.resumeSocket();
      }
    });
  }

  /// ADR-0007: when false, [query] is remote-only (pre-ADR behavior) — the
  /// rollback switch for the local-first merged read path.
  bool localFirstEnabled = true;

  List<RelayConnection> get connections => _relays.values.toList();
  List<String> get connectedUrls => _relays.entries
      .where((e) => e.value.isConnected)
      .map((e) => e.key)
      .toList();

  int get connectedCount =>
      _relays.values.where((r) => r.isConnected).length;

  /// Reconnect any dead sockets. Called when the app returns to the
  /// foreground — Android suspends idle sockets (20min–1hr), so on resume
  /// we kick every disconnected relay back to life (each reconnect then
  /// re-issues its live subscriptions via `_resubscribeAll`).
  Future<void> reconnectDead() async {
    // Snapshot the connections FIRST. `connect()` can add new entries to
    // `_relays` (outbox routing / ensureConnection during resubscribe), and
    // iterating the live map while it's mutated throws
    // "Concurrent modification during iteration" (the resume crash).
    final snapshot = _relays.values.toList();
    for (final conn in snapshot) {
      if (!conn.isConnected &&
          conn.state != RelayState.connecting &&
          conn.state != RelayState.authRequired) {
        // Reset the backoff so resume reconnects immediately, not after the
        // capped 30s backoff that built up while the phone was idle.
        conn.resetBackoff();
        await conn.connect();
      }
    }
  }

  /// Create a connection with the fleet's health hooks wired (ADR-0008 P3).
  /// One factory so every creation site (connectAll/addRelay/ensureConnection/
  /// queryOnRelay/publish/publishWithAckTo) scores identically.
  RelayConnection _newConnection(String url) {
    final conn = RelayConnection(url, processor: frameProcessor);
    conn.onAuthChallenge = authHandler != null
        ? (challenge) => authHandler!(url, challenge)
        : null;
    // Fleet health hooks → the tracker (persisted `relay_health`).
    conn.onConnectSuccess = () => health.recordConnectSuccess(url);
    conn.onConnectFailure = () => health.recordConnectFailure(url);
    conn.onEose = (ms) => health.recordEose(url, ms);
    conn.onEventDelivered = () => health.recordEventDelivered(url);
    return conn;
  }

  Future<void> connectAll() async {
    // ADR-0008 P3: load persisted fleet health once so a cold start ranks
    // relays by learned behavior (not blind).
    await health.load();
    final futures = relayUrls.map((url) {
      if (!_relays.containsKey(url)) {
        final conn = _newConnection(url);
        _relays[url] = conn;
        return conn.connect();
      }
      return Future.value();
    });
    // Wait for all but don't throw on failures
    await Future.wait(futures.map((f) => f.catchError((_) {})));
  }

  /// Query events with EOSE tracking — returns when all connected READ
  /// relays have sent EOSE or timeout, whichever comes first. A relay the
  /// user marked write-only is never asked for events.
  ///
  /// ADR-0007: **local-first merged.** The local store answers instantly
  /// (offline-correct) and remote relays supplement in parallel; results
  /// merge deduped by id, newest-first. Filters the local index can't
  /// answer (uppercase NIP-22 `A`/`E` scopes, or `remoteOnly`) are served
  /// remote-only for that query. Rollback: [localFirstEnabled] = false.
  Future<List<NostrEvent>> query(
    List<NostrFilter> filters, {
    Duration timeout = const Duration(seconds: 5),
  }) async {
    if (!localFirstEnabled || !_hasLocalUnsupportedScope(filters)) {
      return _queryRemote(filters, timeout: timeout);
    }
    return localFirstQuery(
      filters,
      store: EventStore.instance,
      remoteQuery: (fs) => _queryRemote(fs, timeout: timeout),
      // The merged answer must never be slower than the remote leg alone —
      // local is instant, remote is the bound.
      remoteWait: timeout,
    );
  }

  /// True when ANY filter carries a scope the local single-letter tag index
  /// can't answer: an uppercase NIP-22 `A`/`E` (a distinct wire scope the
  /// store doesn't index) or an explicit `remoteOnly` marker. Such queries
  /// go remote-only for correctness (a wrong local answer is worse than an
  /// empty one).
  bool _hasLocalUnsupportedScope(List<NostrFilter> filters) {
    for (final f in filters) {
      if (f.remoteOnly) return false;
      final tags = f.tagFilters;
      if (tags != null) {
        for (final name in tags.keys) {
          if (name.length == 1 && name.toUpperCase() == name &&
              name.toLowerCase() != name) {
            return false; // uppercase single-letter scope → remote-only
          }
        }
      }
    }
    return true; // all scopes are locally answerable
  }

  /// The remote-only query path (pre-ADR-0007 behavior, and the remote leg
  /// of the merged query).
  ///
  /// ADR-0008 P3 **top-K fan-out**: a query goes to the platform relay(s) +
  /// the top-K healthiest connected read relays (K=[queryFanoutK]) — NOT to
  /// ALL of them. Broadcasting every query to 9 relays was the "too many
  /// events at once" flood on BOTH the server (9× sockets × queries) and the
  /// client's verify/merge pipeline (9× duplicate frames). The local store
  /// + top-K healthy relays answers the same query with a fraction of the
  /// traffic; a slow/failing relay self-demotes out of the K via the score.
  static const queryFanoutK = 4;

  Future<List<NostrEvent>> _queryRemote(
    List<NostrFilter> filters, {
    Duration timeout = const Duration(seconds: 5),
  }) async {
    final events = <NostrEvent>[];
    final seen = <String>{};
    final allEose = <Future<void>>[];
    final platformEose = <Future<void>>[];
    final subscriptions = <(RelayConnection, String)>[];

    // Candidate read relays (honor the user's read-intent set when one
    // exists — empty = first run, everything allowed).
    final candidates = _relays.values.where((relay) {
      if (readRelayUrls.isNotEmpty &&
          !readRelayUrls.contains(normalizeRelayUrl(relay.url))) {
        return false;
      }
      return relay.isConnected;
    }).toList();

    // Top-K by (tier, score): platform always in, healthiest fill the rest.
    final fanoutUrls = health
        .topK(candidates.map((r) => r.url), k: queryFanoutK)
        .toSet();
    final targets = candidates.where((r) => fanoutUrls.contains(r.url));

    for (final relay in targets) {
      final sub = relay.subscribeWithEose(filters, oneShot: true);
      subscriptions.add((relay, sub.id));
      allEose.add(sub.eose);
      if (health.tierOf(relay.url) == DbRelayTier.platform) {
        platformEose.add(sub.eose);
      }

      sub.stream.listen((event) {
        if (seen.add(event.id)) {
          events.add(event);
        }
      });
    }

    if (subscriptions.isEmpty) return events;

    /**
     * "Good-enough" completion — don't let the slowest relay stall the UI.
     *
     * The old behavior waited for EVERY target's EOSE (or the full timeout),
     * so one slow/dead relay stretched EVERY screen (feed, profiles,
     * notifications) to the timeout even when the hub had already answered
     * fully (the divine-mobile #2669 failure mode). Now a query resolves
     * early when EITHER:
     *
     *  1. **All** EOSE arrived (ideal, unchanged), or
     *  2. **Every platform (T0) relay answered** — our hub holds the synced
     *     community slice, so its answer IS the complete answer; the
     *     fallbacks only add out-of-slice extras that aren't worth blocking
     *     the frame for, or
     *  3. The timeout hit (fallback, unchanged).
     *
     * Stragglers' sockets are unsubscribed right after, so nothing leaks.
     */
    await Future.any([
      Future.wait(allEose),
      if (platformEose.isNotEmpty) Future.wait(platformEose),
      Future.delayed(timeout),
    ]);

    // Cleanup subscriptions
    for (final (relay, subId) in subscriptions) {
      relay.unsubscribe(subId);
    }

    return events;
  }

  /// Subscribe for streaming (live) events.
  Stream<NostrEvent> subscribe(
    List<NostrFilter> filters, {
    List<String>? relays,
  }) {
    final seen = <String>{};
    final controller = StreamController<NostrEvent>.broadcast();

    // Determine which relays to use. If `relays` is provided, ensure those
    // connections exist (ad-hoc, just for this subscription) and use them.
    final targetRelays = <RelayConnection>[];
    if (relays != null && relays.isNotEmpty) {
      for (final url in relays) {
        final normalized = normalizeRelayUrl(url);
        var conn = _relays[normalized];
        if (conn == null) {
          conn = _newConnection(normalized);
          _relays[normalized] = conn;
          // Fire-and-forget connect; the subscription will be used once connected
          conn.connect().catchError((_) {});
        }
        _touchAdhoc(normalized);
        targetRelays.add(conn);
      }
    } else {
      targetRelays.addAll(_relays.values);
    }

    // Forward events from each relay, deduping by event id
    final subscriptions = <(RelayConnection, String)>[];
    for (final relay in targetRelays) {
      // Wait for connection before subscribing
      if (!relay.isConnected) {
        // Try to subscribe anyway once connection finishes; if connection
        // hasn't completed within 5s, skip.
        Future.doWhile(() async {
          await Future.delayed(const Duration(milliseconds: 200));
          return !relay.isConnected && !controller.isClosed;
        }).timeout(const Duration(seconds: 5), onTimeout: () {});
      }
      if (!relay.isConnected) continue;

      final (subId, stream) = relay.subscribe(filters);
      subscriptions.add((relay, subId));
      stream.listen(
        (event) {
          if (!controller.isClosed && seen.add(event.id)) {
            controller.add(event);
          }
        },
        onDone: () {},
        onError: (_) {},
      );
    }

    // When the outer stream is cancelled, close inner subs
    controller.onCancel = () {
      for (final (relay, subId) in subscriptions) {
        relay.unsubscribe(subId);
      }
    };

    return controller.stream;
  }

  /// Publish to all connected WRITE relays and wait for at least one to
  /// accept. The Manage Relays screen's read/write toggles drive this — a
  /// relay the user marked read-only is never asked to store anything.
  ///
  /// Returns true if ≥1 relay acknowledged the event. Never throws.
  Future<bool> publishWithAck(NostrEvent event) async {
    var connected = _relays.values.where((r) => r.isConnected).toList();
    // Honor the write-intent set when one exists (empty = first run, before
    // the settings notifier has loaded — publish everywhere then).
    if (writeRelayUrls.isNotEmpty) {
      final allowed = connected
          .where((r) => writeRelayUrls.contains(normalizeRelayUrl(r.url)))
          .toList();
      if (allowed.isNotEmpty) connected = allowed;
    }
    if (connected.isEmpty) return false;
    final results = await Future.wait(
      connected.map((r) => r.publishWithAck(event)),
    );
    return results.any((accepted) => accepted);
  }

  /// Publish to all connected relays (or a targeted subset).
  void publish(NostrEvent event, {List<String>? relays}) {
    if (relays != null && relays.isNotEmpty) {
      for (final url in relays) {
        final normalized = normalizeRelayUrl(url);
        var conn = _relays[normalized];
        if (conn == null) {
          conn = _newConnection(normalized);
          _relays[normalized] = conn;
          _touchAdhoc(normalized);
          conn.connect().then((_) {
            conn?.publish(event);
          }).catchError((_) {});
          continue;
        }
        _touchAdhoc(normalized);
        if (conn.isConnected) {
          conn.publish(event);
        } else {
          // Wait briefly for connection, then publish
          Future.doWhile(() async {
            await Future.delayed(const Duration(milliseconds: 200));
            return !conn!.isConnected;
          }).timeout(const Duration(seconds: 5), onTimeout: () {}).then((_) {
            if (conn!.isConnected) conn.publish(event);
          });
        }
      }
      return;
    }
    for (final relay in _relays.values) {
      if (relay.isConnected) {
        relay.publish(event);
      }
    }
  }

  Future<void> addRelay(String url) async {
    final normalized = normalizeRelayUrl(url);
    if (!_relays.containsKey(normalized)) {
      relayUrls.add(normalized);
      final conn = _newConnection(normalized);
      _relays[normalized] = conn;
      await conn.connect();
    }
  }

  /// Ensure a connection exists for [url] (ad-hoc, not persisted to
  /// [relayUrls]) and kick off connect. Returns immediately — connection
  /// happens in the background.
  void ensureConnection(String url) {
    final normalized = normalizeRelayUrl(url);
    if (!_relays.containsKey(normalized)) {
      final conn = _newConnection(normalized);
      _relays[normalized] = conn;
      conn.connect().catchError((_) {});
    }
    _touchAdhoc(normalized);
  }

  /// Query a SINGLE relay (ad-hoc connection created if needed) with EOSE
  /// tracking. Returns as soon as the relay sends EOSE or [timeout] hits —
  /// much faster than subscribe-with-fixed-timeout for one-off lookups.
  Future<List<NostrEvent>> queryOnRelay(
    String url,
    List<NostrFilter> filters, {
    Duration timeout = const Duration(seconds: 3),
    Duration connectWait = const Duration(seconds: 2),
  }) async {
    final normalized = normalizeRelayUrl(url);
    var conn = _relays[normalized];
    if (conn == null) {
      conn = _newConnection(normalized);
      _relays[normalized] = conn;
      conn.connect().catchError((_) {});
    }
    _touchAdhoc(normalized);
    final connection = conn;

    // Wait for connection (bounded).
    final deadline = DateTime.now().add(connectWait);
    while (!connection.isConnected && DateTime.now().isBefore(deadline)) {
      await Future.delayed(const Duration(milliseconds: 50));
    }
    if (!connection.isConnected) return [];

    final events = <NostrEvent>[];
    final seen = <String>{};
    final sub = connection.subscribeWithEose(filters, oneShot: true);
    final listener = sub.stream.listen((e) {
      if (seen.add(e.id)) events.add(e);
    });
    try {
      await Future.any([sub.eose, Future.delayed(timeout)]);
    } finally {
      await listener.cancel();
      connection.unsubscribe(sub.id);
    }
    return events;
  }

  /// Publish to a specific set of relays and wait for at least one to ack.
  /// All targets connect CONCURRENTLY; we wait briefly for any to come up,
  /// publish to all connected ones at once, and return on the first ack.
  Future<bool> publishWithAckTo(
    NostrEvent event,
    List<String> relayUrls, {
    Duration connectWait = const Duration(milliseconds: 1500),
    Duration timeout = const Duration(seconds: 6),
  }) async {
    final targets = <RelayConnection>[];
    for (final url in relayUrls) {
      final normalized = normalizeRelayUrl(url);
      var conn = _relays[normalized];
      if (conn == null) {
        conn = _newConnection(normalized);
        _relays[normalized] = conn;
        conn.connect().catchError((_) {});
      }
      _touchAdhoc(normalized);
      targets.add(conn);
    }

    // Already-connected relays publish immediately; new ones get a SHORT
    // shared window — not 3s each (that made sends take 10-20s).
    final onlineNow = targets.where((c) => c.isConnected).toList();
    if (onlineNow.isEmpty) {
      final deadline = DateTime.now().add(connectWait);
      while (targets.every((c) => !c.isConnected) &&
          DateTime.now().isBefore(deadline)) {
        await Future.delayed(const Duration(milliseconds: 50));
      }
    }
    final online = targets.where((c) => c.isConnected).toList();
    if (online.isEmpty) return false;

    final results = await Future.wait(
      online.map((c) => c.publishWithAck(event, timeout: timeout)),
    );
    return results.any((ok) => ok);
  }

  void removeRelay(String url) {
    final normalized = normalizeRelayUrl(url);
    _relays[normalized]?.disconnect();
    _relays.remove(normalized);
    relayUrls.remove(normalized);
  }

  Map<String, RelayState> get relayStates =>
      Map.fromEntries(_relays.entries.map((e) => MapEntry(e.key, e.value.state)));

  void disconnectAll() {
    for (final r in _relays.values) {
      r.disconnect();
    }
    _relays.clear();
  }
}
