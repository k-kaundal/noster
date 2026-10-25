import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' show Random;

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/relay/relay_core.dart';

/// ADR-0007 Phase 3 — the WebSocket transport for [LocalRelay].
///
/// Puts a real NIP-01 socket in front of the in-process relay core, so the
/// app's own UI (and tests over a real socket) talk to it exactly like a
/// remote relay. One [LocalRelay] core, one [RelaySession] per connection.
///
/// Security (decisions from `docs/LOCAL_RELAY_SECURITY_BACKGROUND.md`):
///
/// - **Loopback only** — binds `127.0.0.1`, never `0.0.0.0`. LAN exposure
///   is a separate, opt-in, NIP-42-gated phase 6.
/// - **Random port** — binds port 0 (OS-assigned) so the well-known 4869
///   isn't trivially scannable by other on-device apps.
/// - **Per-boot token** — required as `?auth=<token>` on the upgrade
///   request; a wrong/missing token closes the connection. On Android,
///   loopback is a *shared* namespace: any installed app can connect to
///   127.0.0.1, so the token is what makes the endpoint private.
/// - **Request caps** — a compromised/curious local client can't OOM the
///   isolate: max frame size, max events/REQs per frame, max subscriptions
///   per connection, max connections.
class LocalRelayServer {
  LocalRelayServer._({
    required this.relay,
    required this.authToken,
    required this._server,
  });

  final LocalRelay relay;

  /// The token every connection must present (see class doc). Generated per
  /// boot by [start], never persisted, never logged.
  final String authToken;

  final HttpServer _server;
  final _sessions = <String, RelaySession>{};
  StreamSubscription<RelayFrame>? _frameSub;

  /// Request caps (a hostile local client can't exhaust the isolate).
  static const maxFrameBytes = 256 * 1024; // 256 KB per ws frame
  static const maxEventsPerFrame = 1; // NIP-01: one EVENT per frame
  static const maxFiltersPerReq = 10;
  static const maxSubsPerConnection = 20;
  static const maxConnections = 8;

  /// The bound host — always loopback.
  static const host = '127.0.0.1';

  /// The actual bound port (OS-assigned when [start] is given port 0).
  int get port => _server.port;

  /// The ws URI clients connect to (includes the auth token).
  Uri get uri => Uri.parse('ws://$host:$port/?auth=$authToken');

  /// Start the server on `127.0.0.1` (random OS-assigned port by default).
  /// [authToken] defaults to a fresh random 32-hex value per boot.
  static Future<LocalRelayServer> start({
    required LocalRelay relay,
    String? authToken,
    int port = 0,
  }) async {
    final server = await HttpServer.bind(
      InternetAddress.loopbackIPv4,
      port,
    );
    final token = authToken ?? _randomToken();
    final self = LocalRelayServer._(relay: relay, authToken: token, server: server);
    self._listen();
    return self;
  }

  static String _randomToken() {
    final r = Random.secure();
    return List.generate(
      16,
      (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }

  void _listen() {
    // Fan every outbound relay frame to its owning session's socket.
    _frameSub = relay.frames.listen((frame) {
      _sessions[frame.sessionId]?.send(frame);
    });

    _server.listen((request) async {
      // Only ws upgrades to `/` with a valid token are served.
      final tokenOk = request.uri.queryParameters['auth'] == authToken;
      final isUpgrade = WebSocketTransformer.isUpgradeRequest(request);
      if (!isUpgrade || !tokenOk || _sessions.length >= maxConnections) {
        request.response
          ..statusCode = tokenOk ? HttpStatus.badRequest : HttpStatus.forbidden
          ..close();
        return;
      }
      final socket = await WebSocketTransformer.upgrade(request);
      final sessionId = 'ws-${_sessions.length}-${DateTime.now().microsecondsSinceEpoch}';
      final session = RelaySession._(
        id: sessionId,
        socket: socket,
        relay: relay,
        onClose: () {
          _sessions.remove(sessionId);
          relay.closeSession(sessionId);
        },
      );
      _sessions[sessionId] = session;
      session.listen();
    });
  }

  Future<void> stop() async {
    await _frameSub?.cancel();
    for (final s in _sessions.values.toList()) {
      await s.close();
    }
    _sessions.clear();
    await _server.close(force: true);
  }
}

/// One client connection: parses NIP-01 client messages off the socket and
/// writes relay frames back. All protocol decisions live in [LocalRelay].
class RelaySession {
  RelaySession._({
    required this.id,
    required this.socket,
    required this.relay,
    required this.onClose,
  });

  final String id;
  final WebSocket socket;
  final LocalRelay relay;
  final void Function() onClose;

  final _openSubs = <String>{};

  void listen() {
    socket.listen(
      _onData,
      onError: (_) => _teardown(),
      onDone: _teardown,
      cancelOnError: true,
    );
  }

  Future<void> _onData(dynamic data) async {
    if (data is! String) return; // binary frames unsupported
    if (data.length > LocalRelayServer.maxFrameBytes) {
      _send(['NOTICE', 'error: frame too large']);
      return;
    }
    List<dynamic> msg;
    try {
      msg = jsonDecode(data) as List<dynamic>;
    } catch (_) {
      _send(['NOTICE', 'error: invalid JSON']);
      return;
    }
    if (msg.isEmpty) return;
    final type = msg[0];
    switch (type) {
      case 'REQ':
        await _onReq(msg);
      case 'EVENT':
        await _onEvent(msg);
      case 'CLOSE':
        _onCloseMsg(msg);
      default:
        _send(['NOTICE', 'error: unknown message type']);
    }
  }

  Future<void> _onReq(List<dynamic> msg) async {
    if (msg.length < 3 || msg[1] is! String) {
      _send(['NOTICE', 'error: malformed REQ']);
      return;
    }
    final subId = msg[1] as String;
    if (subId.isEmpty || subId.length > 64) {
      _send(['CLOSED', subId, 'invalid: subscription id']);
      return;
    }
    final rawFilters = msg.sublist(2);
    if (rawFilters.length > LocalRelayServer.maxFiltersPerReq) {
      _send(['CLOSED', subId, 'error: too many filters']);
      return;
    }
    if (_openSubs.length >= LocalRelayServer.maxSubsPerConnection &&
        !_openSubs.contains(subId)) {
      _send(['CLOSED', subId, 'error: subscription limit']);
      return;
    }
    final filters = <NostrFilter>[];
    for (final raw in rawFilters) {
      if (raw is! Map) {
        _send(['CLOSED', subId, 'error: malformed filter']);
        return;
      }
      filters.add(_filterFromJson(raw));
    }
    _openSubs.add(subId);
    await relay.req(id, subId, filters);
  }

  Future<void> _onEvent(List<dynamic> msg) async {
    if (msg.length < 2 || msg[1] is! Map) {
      _send(['NOTICE', 'error: malformed EVENT']);
      return;
    }
    NostrEvent event;
    try {
      event = NostrEvent.fromJson((msg[1] as Map).cast<String, dynamic>());
    } catch (_) {
      _send(['NOTICE', 'error: malformed event']);
      return;
    }
    await relay.onClientEvent(id, event);
  }

  void _onCloseMsg(List<dynamic> msg) {
    if (msg.length < 2 || msg[1] is! String) return;
    final subId = msg[1] as String;
    _openSubs.remove(subId);
    relay.close(id, subId);
  }

  /// Parse a NIP-01 filter JSON object into a [NostrFilter].
  static NostrFilter _filterFromJson(Map<dynamic, dynamic> j) {
    List<String>? strList(dynamic v) =>
        v is List ? v.map((x) => '$x').toList() : null;
    List<int>? intList(dynamic v) =>
        v is List ? v.whereType<num>().map((x) => x.toInt()).toList() : null;

    final tagFilters = <String, List<String>>{};
    for (final entry in j.entries) {
      final key = '${entry.key}';
      // `#e`/`#p`/… single-letter tag filters.
      if (key.startsWith('#') && key.length == 2) {
        final values = strList(entry.value);
        if (values != null) tagFilters[key.substring(1)] = values;
      }
    }
    return NostrFilter(
      ids: strList(j['ids']),
      authors: strList(j['authors']),
      kinds: intList(j['kinds']),
      tagFilters: tagFilters.isEmpty ? null : tagFilters,
      since: (j['since'] as num?)?.toInt(),
      until: (j['until'] as num?)?.toInt(),
      limit: (j['limit'] as num?)?.toInt(),
      search: j['search'] as String?,
    );
  }

  void send(RelayFrame frame) => _send(frame.payload);

  void _send(List<dynamic> payload) {
    try {
      socket.add(jsonEncode(payload));
    } catch (_) {
      _teardown();
    }
  }

  void _teardown() {
    onClose();
    try {
      socket.close();
    } catch (_) {}
  }

  Future<void> close() async {
    _teardown();
    await socket.close();
  }
}
