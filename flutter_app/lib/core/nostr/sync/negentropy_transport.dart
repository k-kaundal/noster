import 'dart:async';
import 'dart:io';

import 'package:nostrfeed_mobile/core/nostr/sync/negentropy_sync.dart';

/// ADR-0007 Phase 5 — the production [NegTransport] over a real WebSocket.
///
/// One connection per sync pass (the client closes it after NEG-CLOSE and
/// any REQ-download). Text frames only — NEG messages are hex-encoded JSON
/// per NIP-77.
class WsNegTransport implements NegTransport {
  WsNegTransport._(this._socket);

  final WebSocket _socket;

  static Future<WsNegTransport> connect(
    Uri url, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    final socket = await WebSocket.connect(
      url.toString(),
    ).timeout(timeout);
    return WsNegTransport._(socket);
  }

  @override
  Stream<String> get messages => _socket
      .where((data) => data is String)
      .cast<String>()
      .asBroadcastStream();

  @override
  void send(String line) => _socket.add(line);

  @override
  Future<void> close() async {
    try {
      await _socket.close();
    } catch (_) {}
  }
}
