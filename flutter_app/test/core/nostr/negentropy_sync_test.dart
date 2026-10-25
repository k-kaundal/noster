import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/sync/negentropy.dart';
import 'package:nostrfeed_mobile/core/nostr/sync/negentropy_sync.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// NIP-77 end-to-end: a client store reconciling against a fake relay over
/// the injected [NegTransport]. The relay speaks the real protocol (a
/// responder-side [Negentropy] over its own record set), so this exercises
/// the full NEG-OPEN → NEG-MSG × n → NEG-CLOSE → REQ-download flow.
void main() {
  sqfliteFfiInit();

  String h(int byte) => (byte.toRadixString(16).padLeft(2, '0')) * 32;

  NostrEvent ev({required String id, int kind = 1, int createdAt = 1000}) =>
      NostrEvent(
        id: id,
        pubkey: h(9),
        createdAt: createdAt,
        kind: kind,
        tags: const [],
        content: 'post $id',
        sig: 'c' * 128,
      );

  Future<EventStore> freshStore(List<NostrEvent> events) async {
    // Override FIRST, then reset, so no stale in-memory DB from a previous
    // test can be reused (debugReset closes the old handle; the next access
    // opens through the override).
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
    final store = EventStore.instance;
    await store.debugReset();
    await store.ingest(events);
    return store;
  }

  tearDown(() async {
    await EventStore.instance.debugReset();
    EventStore.debugOpenOverride = null;
  });

  /// A fake relay that holds [relayEvents], answers NEG-OPEN/NEG-MSG via a
  /// responder-side Negentropy, and answers REQ(ids) with its held events.
  ({Future<NegTransport> Function(Uri) connect, _FakeRelay relay}) fakeRelay(
    List<NostrEvent> relayEvents,
  ) {
    final relay = _FakeRelay(relayEvents);
    Future<NegTransport> connect(Uri url) async => relay.attach();
    return (connect: connect, relay: relay);
  }

  test('client learns + downloads exactly the events it was missing', () async {
    final common = [
      ev(id: h(1), createdAt: 1000),
      ev(id: h(2), createdAt: 1001),
    ];
    final relayOnly = [
      ev(id: h(3), createdAt: 1002),
      ev(id: h(4), createdAt: 1003),
    ];
    final clientOnly = [ev(id: h(5), createdAt: 1004)];

    final store = await freshStore([...common, ...clientOnly]);
    final f = fakeRelay([...common, ...relayOnly]);

    final client = NegentropySyncClient(store: store);
    final result = await client.syncWithRelay(
      wsUrl: 'wss://fake.relay',
      filter: NostrFilter(kinds: [1]),
      connect: f.connect,
    );

    expect(result, isNotNull);
    // We have h(5) the relay lacks; the relay has h(3)+h(4) we lacked.
    expect(result!.haveIds, [h(5)]);
    expect(result.needIds.toSet(), {h(3), h(4)});

    // The missing events were downloaded into our store.
    expect((await store.eventById(h(3)))!.content, 'post ${h(3)}');
    expect(await store.eventById(h(4)), isNotNull);
  });

  test('identical sets reconcile to empty diff, no downloads', () async {
    final events = [ev(id: h(10)), ev(id: h(11))];
    final store = await freshStore(events);
    final f = fakeRelay(events);

    final client = NegentropySyncClient(store: store);
    final result = await client.syncWithRelay(
      wsUrl: 'wss://fake.relay',
      filter: NostrFilter(kinds: [1]),
      connect: f.connect,
      // Watch the REQ count directly: with an empty diff, the client must
      // never issue a download REQ.
    );

    expect(result!.haveIds, isEmpty);
    expect(result.needIds, isEmpty);
    // No REQ(ids) download happened — the diff was empty.
    expect(f.relay.reqCount, 0,
        reason: 'empty diff must not trigger a download REQ');
  });

  test('a relay answering NEG-ERR returns null (fallback path)', () async {
    final store = await freshStore([ev(id: h(20))]);
    Future<NegTransport> connect(Uri url) async => _NegErrTransport();
    final client = NegentropySyncClient(store: store);
    final result = await client.syncWithRelay(
      wsUrl: 'wss://old.relay',
      filter: NostrFilter(kinds: [1]),
      connect: connect,
    );
    expect(result, isNull);
  });

  test('an unreachable relay returns null, never throws', () async {
    final store = await freshStore([ev(id: h(21))]);
    Future<NegTransport> connect(Uri url) =>
        throw const SocketExceptionManually('nope');
    final client = NegentropySyncClient(store: store);
    final result = await client.syncWithRelay(
      wsUrl: 'wss://dead.relay',
      filter: NostrFilter(kinds: [1]),
      connect: connect,
    );
    expect(result, isNull);
  });
}

class SocketExceptionManually implements Exception {
  const SocketExceptionManually(this.message);
  final String message;
}

/// The fake relay: real responder-side negentropy + a held event set.
class _FakeRelay {
  _FakeRelay(this.events);

  final List<NostrEvent> events;
  int reqCount = 0;

  Negentropy _buildNeg() {
    final storage = NegentropyStorage();
    for (final e in events) {
      storage.insert(e.createdAt, _hexBytes(e.id));
    }
    storage.seal();
    return Negentropy(storage);
  }

  Future<NegTransport> attach() async => _FakeRelayTransport(this);
}

class _FakeRelayTransport implements NegTransport {
  _FakeRelayTransport(this._relay);

  final _FakeRelay _relay;
  late Negentropy _neg;
  // Broadcast, like a real WebSocket stream — the client may listen more
  // than once across its internal phases.
  final _in = StreamController<String>.broadcast();
  bool _negReady = false;

  @override
  Stream<String> get messages => _in.stream;

  @override
  void send(String line) {
    // Answer asynchronously — a real socket's reply arrives on a later
    // event-loop turn; answering synchronously can starve the loop when a
    // broadcast listener bounces sends back immediately.
    scheduleMicrotask(() {
      if (_in.isClosed) return;
      final msg = jsonDecode(line) as List<dynamic>;
      switch (msg[0]) {
        case 'NEG-OPEN':
          _neg = _relay._buildNeg();
          _negReady = true;
          final reply = _neg.reconcile(_hexBytes(msg[3] as String));
          _in.add(jsonEncode(
              ['NEG-MSG', msg[1], _hexOf(reply.reply ?? Uint8List(0))]));
          break;
        case 'NEG-MSG':
          if (!_negReady) return;
          final reply = _neg.reconcile(_hexBytes(msg[2] as String));
          // Responder always answers (may be an all-skip message).
          _in.add(jsonEncode(
              ['NEG-MSG', msg[1], _hexOf(reply.reply ?? Uint8List(0))]));
          break;
        case 'NEG-CLOSE':
          // Negotiation over; nothing to send back.
          break;
        case 'REQ':
          _relay.reqCount++;
          final subId = msg[1] as String;
          final filter = msg[2] as Map<String, dynamic>;
          final wanted = (filter['ids'] as List?)?.cast<String>() ?? const [];
          for (final e in _relay.events) {
            if (wanted.contains(e.id)) {
              _in.add(jsonEncode(['EVENT', subId, e.toJson()]));
            }
          }
          _in.add(jsonEncode(['EOSE', subId]));
          break;
      }
    });
  }

  @override
  Future<void> close() async {
    await _in.close();
  }
}

Uint8List _hexBytes(String hex) => Uint8List.fromList(List.generate(
    hex.length ~/ 2,
    (i) => int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16)));

String _hexOf(Uint8List b) =>
    b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();

/// A relay that only answers NEG-ERR (unsupported).
class _NegErrTransport implements NegTransport {
  final _in = StreamController<String>.broadcast();

  @override
  Stream<String> get messages => _in.stream;

  @override
  void send(String line) {
    scheduleMicrotask(() {
      if (_in.isClosed) return;
      final msg = jsonDecode(line) as List<dynamic>;
      if (msg[0] == 'NEG-OPEN') {
        _in.add(jsonEncode(['NEG-ERR', msg[1], 'blocked: unsupported']));
      }
    });
  }

  @override
  Future<void> close() async {
    await _in.close();
  }
}
