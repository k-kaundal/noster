import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:uuid/uuid.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';

enum RelayState { disconnected, connecting, connected, authRequired, error }

/// A single relay WebSocket connection with NIP-42 auth support.
class RelayConnection {
  final String url;
  WebSocketChannel? _channel;
  RelayState state = RelayState.disconnected;
  String? lastError;
  final Map<String, StreamController<NostrEvent>> _subs = {};
  final _uuid = const Uuid();

  /// NIP-42 auth challenge
  String? _authChallenge;

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

  RelayConnection(this.url);

  bool get isConnected => state == RelayState.connected;

  Future<void> connect() async {
    if (state == RelayState.connected) return;
    _intentionallyClosed = false;
    _setState(RelayState.connecting);

    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));
      await _channel!.ready.timeout(const Duration(seconds: 10));
      _reconnectAttempts = 0;
      _setState(RelayState.connected);
      _channel!.stream.listen(
        _handleMessage,
        onError: _handleError,
        onDone: _handleDone,
      );
    } catch (e) {
      lastError = e.toString();
      _setState(RelayState.error);
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

  void _handleMessage(dynamic raw) {
    try {
      final data = jsonDecode(raw as String) as List;
      final type = data[0] as String;

      switch (type) {
        case 'EVENT':
          final subId = data[1] as String;
          final event = NostrEvent.fromJson(data[2] as Map<String, dynamic>);
          if (!event.isExpired) {
            _subs[subId]?.add(event);
          }
          break;
        case 'EOSE':
          final subId = data[1] as String;
          final completer = _eoseCompleters[subId];
          if (completer != null && !completer.isCompleted) {
            completer.complete();
          }
          break;
        case 'OK':
          // ["OK", <event_id>, <true|false>, <message>]
          if (data.length >= 3) {
            final eventId = data[1] as String;
            final accepted = data[2] as bool;
            final completer = _publishAcks.remove(eventId);
            if (completer != null && !completer.isCompleted) {
              completer.complete(accepted);
            }
          }
          break;
        case 'AUTH':
          _authChallenge = data[1] as String;
          _setState(RelayState.authRequired);
          _respondToAuth();
          break;
        case 'NOTICE':
          break;
        case 'CLOSED':
          final subId = data[1] as String;
          final completer = _eoseCompleters[subId];
          if (completer != null && !completer.isCompleted) {
            completer.complete();
          }
          _subs.remove(subId)?.close();
          break;
      }
    } catch (_) {}
  }

  Future<void> _respondToAuth() async {
    if (_authChallenge == null || onAuthChallenge == null) return;
    try {
      final authEvent = await onAuthChallenge!(_authChallenge!);
      _channel?.sink.add(jsonEncode(['AUTH', authEvent.toJson()]));
      _setState(RelayState.connected);
    } catch (_) {}
  }

  /// Subscribe and get a stream + EOSE future.
  ({String id, Stream<NostrEvent> stream, Future<void> eose}) subscribeWithEose(
    List<NostrFilter> filters,
  ) {
    final id = _uuid.v4().substring(0, 8);
    final controller = StreamController<NostrEvent>.broadcast();
    final eoseCompleter = Completer<void>();
    _subs[id] = controller;
    _eoseCompleters[id] = eoseCompleter;

    if (state == RelayState.connected) {
      final msg = jsonEncode(['REQ', id, ...filters.map((f) => f.toJson())]);
      _channel?.sink.add(msg);
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
    _subs.remove(subId)?.close();
    _eoseCompleters.remove(subId);
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

  RelayPool({List<String>? relays})
      : relayUrls = List.from(relays ?? Env.defaultRelays);

  List<RelayConnection> get connections => _relays.values.toList();
  List<String> get connectedUrls => _relays.entries
      .where((e) => e.value.isConnected)
      .map((e) => e.key)
      .toList();

  int get connectedCount =>
      _relays.values.where((r) => r.isConnected).length;

  Future<void> connectAll() async {
    final futures = relayUrls.map((url) {
      if (!_relays.containsKey(url)) {
        final conn = RelayConnection(url);
        conn.onAuthChallenge = authHandler != null
            ? (challenge) => authHandler!(url, challenge)
            : null;
        _relays[url] = conn;
        return conn.connect();
      }
      return Future.value();
    });
    // Wait for all but don't throw on failures
    await Future.wait(futures.map((f) => f.catchError((_) {})));
  }

  /// Query events with EOSE tracking — returns when all connected relays
  /// have sent EOSE or timeout, whichever comes first.
  Future<List<NostrEvent>> query(
    List<NostrFilter> filters, {
    Duration timeout = const Duration(seconds: 5),
  }) async {
    final events = <NostrEvent>[];
    final seen = <String>{};
    final eoseFutures = <Future<void>>[];
    final subscriptions = <(RelayConnection, String)>[];

    for (final relay in _relays.values) {
      if (relay.isConnected) {
        final sub = relay.subscribeWithEose(filters);
        subscriptions.add((relay, sub.id));
        eoseFutures.add(sub.eose);

        sub.stream.listen((event) {
          if (seen.add(event.id)) {
            events.add(event);
          }
        });
      }
    }

    if (subscriptions.isEmpty) return events;

    // Wait for all EOSE or timeout
    await Future.any([
      Future.wait(eoseFutures),
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
          conn = RelayConnection(normalized);
          conn.onAuthChallenge = authHandler != null
              ? (challenge) => authHandler!(normalized, challenge)
              : null;
          _relays[normalized] = conn;
          // Fire-and-forget connect; the subscription will be used once connected
          conn.connect().catchError((_) {});
        }
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

  /// Publish to all connected relays and wait for at least one to accept.
  ///
  /// Returns true if ≥1 relay acknowledged the event. Never throws.
  Future<bool> publishWithAck(NostrEvent event) async {
    final connected = _relays.values.where((r) => r.isConnected).toList();
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
          conn = RelayConnection(normalized);
          conn.onAuthChallenge = authHandler != null
              ? (challenge) => authHandler!(normalized, challenge)
              : null;
          _relays[normalized] = conn;
          conn.connect().then((_) {
            conn?.publish(event);
          }).catchError((_) {});
          continue;
        }
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
      final conn = RelayConnection(normalized);
      conn.onAuthChallenge = authHandler != null
          ? (challenge) => authHandler!(normalized, challenge)
          : null;
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
      final conn = RelayConnection(normalized);
      conn.onAuthChallenge = authHandler != null
          ? (challenge) => authHandler!(normalized, challenge)
          : null;
      _relays[normalized] = conn;
      conn.connect().catchError((_) {});
    }
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
      conn = RelayConnection(normalized);
      conn.onAuthChallenge = authHandler != null
          ? (challenge) => authHandler!(normalized, challenge)
          : null;
      _relays[normalized] = conn;
      conn.connect().catchError((_) {});
    }
    final connection = conn;

    // Wait for connection (bounded).
    final deadline = DateTime.now().add(connectWait);
    while (!connection.isConnected && DateTime.now().isBefore(deadline)) {
      await Future.delayed(const Duration(milliseconds: 50));
    }
    if (!connection.isConnected) return [];

    final events = <NostrEvent>[];
    final seen = <String>{};
    final sub = connection.subscribeWithEose(filters);
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
        conn = RelayConnection(normalized);
        conn.onAuthChallenge = authHandler != null
            ? (challenge) => authHandler!(normalized, challenge)
            : null;
        _relays[normalized] = conn;
        conn.connect().catchError((_) {});
      }
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
