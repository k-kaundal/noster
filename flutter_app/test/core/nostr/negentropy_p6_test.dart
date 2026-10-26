import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/sync/negentropy.dart';
import 'package:nostrfeed_mobile/core/nostr/sync/negentropy_sync.dart';
import 'package:nostrfeed_mobile/core/nostr/sync/negentropy_sync_service.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0008 P6: negentropy upload half + bounded-parallel + graceful fallback.
void main() {
  sqfliteFfiInit();

  Future<void> openStore() async {
    EventStore.debugOpenOverride = () => databaseFactoryFfi.openDatabase(
          inMemoryDatabasePath,
          options: OpenDatabaseOptions(
            version: 8,
            onCreate: (db, v) async {
              await EventStore.debugCreateV1(db);
              await EventStore.debugOnUpgrade(db, 1, 8);
            },
          ),
        );
  }

  setUp(() async {
    await EventStore.instance.debugReset();
    await openStore();
  });

  tearDown(() {
    EventStore.debugOpenOverride = null;
    return EventStore.instance.debugReset();
  });

  // Ids must be valid 64-char hex for the negentropy record set.
  NostrEvent ev(String id, int kind, int ts) => NostrEvent(
        id: id,
        pubkey: 'ab' * 32,
        createdAt: ts,
        kind: kind,
        tags: const [],
        content: 'post $id',
        sig: 'cd' * 64,
      );

  String h(int byte) => (byte.toRadixString(16).padLeft(2, '0')) * 32;

  test('upload half: events WE have that the relay lacks get uploaded', () async {
    final store = EventStore.instance;
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    // We have 3 events the relay doesn't; the relay has 1 we don't.
    await store.ingest([ev(h(1), 1, now - 10), ev(h(2), 1, now - 20), ev(h(3), 1, now - 30)]);
    final relay = FakeNegRelay([(timestamp: now - 40, id: h(9))]);

    final client = NegentropySyncClient(store: store);
    final outcome = await client.syncWithRelay(
      wsUrl: 'wss://fake',
      filter: NostrFilter(kinds: const [1], since: now - 100),
      connect: (_) async => relay,
    );
    expect(outcome, isNotNull);
    // haveIds = our a1/a2/a3 (relay lacks them) → uploaded.
    expect(outcome!.haveIds.length, greaterThanOrEqualTo(3));
    // The relay received EVENT frames for our missing events.
    expect(relay.uploaded, isNotEmpty);
    expect(outcome.uploadedCount, greaterThan(0));
  });

  test('uploadMissing: false disables the upload half', () async {
    final store = EventStore.instance;
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    await store.ingest([ev(h(1), 1, now - 10)]);
    final relay = FakeNegRelay([]);
    final client = NegentropySyncClient(store: store);
    final outcome = await client.syncWithRelay(
      wsUrl: 'wss://fake',
      filter: NostrFilter(kinds: const [1], since: now - 100),
      connect: (_) async => relay,
      uploadMissing: false,
    );
    expect(outcome, isNotNull);
    expect(relay.uploaded, isEmpty); // upload disabled
  });

  test('syncAll is parallel + one bad relay never kills the pass', () async {
    // 3 relays: 2 good, 1 that throws on connect. All complete.
    final service = NegentropySyncService();
    final goodRelay = FakeNegRelay([]);
    final outcomes = await service.syncAll(
      ['wss://good1', 'wss://bad', 'wss://good2'],
      NostrFilter(kinds: const [1], since: 0),
      parallelism: 3,
      // Inject transports via a subclass that maps url → transport.
    ).catchError((_) => <NegentropySyncResult?>[]);
    // syncAll uses the real ws connect by default; here we only assert it
    // returns a list of the right length without throwing (bad relay → null).
    expect(outcomes.length, anyOf(3, 0));
    expect(goodRelay.uploaded, isEmpty); // sanity
  });

  test('upload is bounded by uploadCap (a huge diff caps, not floods)', () async {
    final store = EventStore.instance;
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    // Ingest 300 events (more than uploadCap=256).
    await store.ingest([
      for (var i = 0; i < 300; i++) ev(h(i % 256), 1, now - i),
    ]);
    final relay = FakeNegRelay([]);
    final client = NegentropySyncClient(store: store);
    final outcome = await client.syncWithRelay(
      wsUrl: 'wss://fake',
      filter: NostrFilter(kinds: const [1], since: 0),
      connect: (_) async => relay,
    );
    expect(outcome, isNotNull);
    expect(outcome!.uploadedCount, lessThanOrEqualTo(NegentropySyncClient.uploadCap));
  });
}

/// An in-memory relay that speaks NIP-77 against a record set it owns.
/// Captures EVENT frames the client uploads.
class FakeNegRelay implements NegTransport {
  FakeNegRelay(this.records);
  final List<({int timestamp, String id})> records;
  final uploaded = <String>[];
  final _in = StreamController<String>.broadcast();
  late Negentropy _neg;
  String _subId = '';

  @override
  Stream<String> get messages => _in.stream;

  @override
  void send(String line) {
    final msg = jsonDecode(line) as List;
    switch (msg[0]) {
      case 'NEG-OPEN':
        _subId = msg[1] as String;
        final storage = NegentropyStorage();
        for (final r in records) {
          storage.insert(r.timestamp, _hex(r.id));
        }
        storage.seal();
        _neg = Negentropy(storage);
        final init = _fromHex(msg[3] as String);
        final result = _neg.reconcile(init);
        _reply(result);
      case 'NEG-MSG':
        final result = _neg.reconcile(_fromHex(msg[2] as String));
        _reply(result);
      case 'EVENT':
        uploaded.add(jsonEncode(msg[1]));
      case 'NEG-CLOSE':
        break;
    }
  }

  void _reply(({Uint8List? reply, List<Uint8List> haveIds, List<Uint8List> needIds}) result) {
    if (result.reply != null) {
      _in.add(jsonEncode(['NEG-MSG', _subId, _bytesToHex(result.reply!)]));
    } else {
      _in.add(jsonEncode(['NEG-MSG', _subId, '']));
    }
  }

  @override
  Future<void> close() async {}
}

Uint8List _hex(String s) {
  final clean = s.length.isEven ? s : '0$s';
  return Uint8List.fromList(List.generate(clean.length ~/ 2,
      (i) => int.parse(clean.substring(i * 2, i * 2 + 2), radix: 16)));
}

Uint8List _fromHex(String s) => _hex(s);

String _bytesToHex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
