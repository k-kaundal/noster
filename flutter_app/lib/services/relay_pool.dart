import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:uuid/uuid.dart';
import '../models/nostr_models.dart';
import '../config/env.dart';

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

  void publish(NostrEvent event) {
    if (state == RelayState.connected) {
      _channel?.sink.add(jsonEncode(['EVENT', event.toJson()]));
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
  Stream<NostrEvent> subscribe(List<NostrFilter> filters) {
    final seen = <String>{};
    final controller = StreamController<NostrEvent>.broadcast();

    for (final relay in _relays.values) {
      if (relay.isConnected) {
        final (_, stream) = relay.subscribe(filters);
        stream.listen((event) {
          if (seen.add(event.id)) {
            controller.add(event);
          }
        });
      }
    }

    return controller.stream;
  }

  /// Publish to all connected relays.
  void publish(NostrEvent event) {
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
