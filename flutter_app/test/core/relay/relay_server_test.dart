import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:bip340/bip340.dart' as bip340;
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/relay/relay_core.dart';
import 'package:nostrfeed_mobile/core/relay/relay_server.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0007 Phase 3 — real-socket tests: an actual WebSocket client driving
/// NIP-01 against [LocalRelayServer], including the security controls
/// (loopback bind, per-boot token, request caps).
void main() {
  sqfliteFfiInit();

  Future<void> openStore() async {
    EventStore.debugOpenOverride = () => databaseFactoryFfi.openDatabase(
          inMemoryDatabasePath,
          options: OpenDatabaseOptions(
            version: 3,
            onCreate: (db, v) async {
              await EventStore.debugCreateV1(db);
              await EventStore.debugOnUpgrade(db, 1, 3);
            },
          ),
        );
  }

  String h(int byte) => (byte.toRadixString(16).padLeft(2, '0')) * 32;

  NostrEvent signed({
    required String privkey,
    required int kind,
    int? createdAt,
    List<List<String>> tags = const [],
    String content = 'hi',
  }) {
    final pubkey = bip340.getPublicKey(privkey);
    final ts = createdAt ?? DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final id = NostrEvent.computeId(pubkey, ts, kind, tags, content);
    final sig = bip340.sign(privkey, id, randomHex(32));
    return NostrEvent(
      id: id,
      pubkey: pubkey,
      createdAt: ts,
      kind: kind,
      tags: tags,
      content: content,
      sig: sig,
    );
  }

  late LocalRelay relay;
  late LocalRelayServer server;

  setUp(() async {
    await EventStore.instance.debugReset();
    EventStore.debugOpenOverride = null;
    await openStore();
    relay = LocalRelay(store: EventStore.instance);
    server = await LocalRelayServer.start(relay: relay);
  });

  tearDown(() async {
    await server.stop();
    await relay.dispose();
    EventStore.debugOpenOverride = null;
    await EventStore.instance.debugReset();
  });

  /// Connect an authenticated client, returning (socket, received-frames).
  Future<({WebSocket ws, List<List<dynamic>> frames})> connect({
    String? auth,
    int? port,
  }) async {
    final p = port ?? server.port;
    final token = auth ?? server.authToken;
    final ws = await WebSocket.connect('ws://127.0.0.1:$p/?auth=$token');
    final frames = <List<dynamic>>[];
    ws.listen((data) {
      frames.add((jsonDecode(data as String) as List<dynamic>));
    });
    return (ws: ws, frames: frames);
  }

  Future<void> settle([
    Duration d = const Duration(milliseconds: 120),
  ]) =>
      Future<void>.delayed(d);

  test('binds loopback with an OS-assigned port and a per-boot token', () {
    expect(server.port, greaterThan(0));
    expect(server.authToken.length, 32);
    expect(server.uri.host, '127.0.0.1');
    expect(server.uri.queryParameters['auth'], server.authToken);
  });

  test('rejects a connection with a wrong token', () async {
    try {
      await connect(auth: 'wrong-token');
      fail('should have thrown');
    } catch (_) {
      // handshake rejected (403) → WebSocketException
    }
  });

  test('rejects a connection with no token', () async {
    try {
      await WebSocket.connect('ws://127.0.0.1:${server.port}/');
      fail('should have thrown');
    } catch (_) {}
  });

  test('REQ returns stored events then EOSE, then live events', () async {
    final stored = signed(privkey: h(1), kind: 1, content: 'stored');
    await EventStore.instance.ingest([stored]);

    final c = await connect();
    c.ws.add(jsonEncode([
      'REQ',
      'sub1',
      {'kinds': [1]},
    ]));
    await settle();

    // Stored event + EOSE.
    expect(c.frames.any((f) => f[0] == 'EVENT' && f[1] == 'sub1'), isTrue);
    expect(c.frames.any((f) => f[0] == 'EOSE' && f[1] == 'sub1'), isTrue);
    final beforeLive = c.frames.length;

    // A live event after EOSE.
    relay.onEvent(signed(privkey: h(2), kind: 1, content: 'live'));
    await settle();
    expect(c.frames.length, greaterThan(beforeLive));
    expect(
      c.frames.any((f) =>
          f[0] == 'EVENT' && (f[2] as Map)['content'] == 'live'),
      isTrue,
    );
    await c.ws.close();
  });

  test('a valid published EVENT gets OK true and is stored', () async {
    final c = await connect();
    final note = signed(privkey: h(3), kind: 1, content: 'over the wire');
    c.ws.add(jsonEncode(['EVENT', note.toJson()]));
    await settle();

    final ok = c.frames.firstWhere((f) => f[0] == 'OK');
    expect(ok[1], note.id);
    expect(ok[2], isTrue);
    expect(await EventStore.instance.eventById(note.id), isNotNull);
    await c.ws.close();
  });

  test('a forged EVENT gets OK false and is not stored', () async {
    final c = await connect();
    final note = signed(privkey: h(4), kind: 1);
    final forged = note.toJson()..['content'] = 'tampered';
    c.ws.add(jsonEncode(['EVENT', forged]));
    await settle();

    final ok = c.frames.firstWhere((f) => f[0] == 'OK');
    expect(ok[2], isFalse);
    expect(ok[3] as String, startsWith('invalid:'));
    expect(await EventStore.instance.eventById(note.id), isNull);
    await c.ws.close();
  });

  test('CLOSE stops the subscription', () async {
    final c = await connect();
    c.ws.add(jsonEncode([
      'REQ',
      's',
      {'kinds': [1]},
    ]));
    // Wait until the sub is actually registered server-side.
    for (var i = 0; i < 100 && relay.subscriptionCount == 0; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(relay.subscriptionCount, 1);

    c.ws.add(jsonEncode(['CLOSE', 's']));
    // Wait until the close lands server-side (deterministic, no fixed sleep).
    for (var i = 0; i < 100 && relay.subscriptionCount > 0; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(relay.subscriptionCount, 0);

    final before = c.frames.length;
    relay.onEvent(signed(privkey: h(5), kind: 1));
    await settle();
    // No EVENT frames after the close point.
    final after = c.frames.skip(before).where((f) => f[0] == 'EVENT').toList();
    expect(after, isEmpty);
    await c.ws.close();
  });

  test('enforces the subscription cap per connection', () async {
    final c = await connect();
    for (var i = 0; i < LocalRelayServer.maxSubsPerConnection + 2; i++) {
      c.ws.add(jsonEncode([
        'REQ',
        'sub$i',
        {'kinds': [1]},
      ]));
    }
    await settle(const Duration(milliseconds: 300));
    final closed = c.frames.where((f) => f[0] == 'CLOSED').toList();
    expect(closed, isNotEmpty); // the overflow subs were refused
    await c.ws.close();
  });

  test('a malformed frame draws a NOTICE, not a crash', () async {
    final c = await connect();
    c.ws.add('not json at all');
    await settle();
    expect(c.frames.any((f) => f[0] == 'NOTICE'), isTrue);
    // Server still alive: a valid REQ still works.
    c.ws.add(jsonEncode([
      'REQ',
      'ok',
      {'kinds': [1]},
    ]));
    await settle();
    expect(c.frames.any((f) => f[0] == 'EOSE'), isTrue);
    await c.ws.close();
  });
}
