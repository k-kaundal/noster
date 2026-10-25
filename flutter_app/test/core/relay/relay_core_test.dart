import 'dart:async';

import 'package:bip340/bip340.dart' as bip340;
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/relay/relay_core.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

/// ADR-0007 Phase 2 — wire-protocol tests for the in-process relay core.
/// No socket: we drive [LocalRelay] with NIP-01 messages and assert on the
/// [RelayFrame] stream (the transport renders these in phase 3).
void main() {
  sqfliteFfiInit();

  const session = 's1';

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

  /// A genuinely-signed event (the relay verifies signatures — a forged
  /// event must be rejected with `OK false`).
  NostrEvent signed({
    required String privkey,
    required int kind,
    int? createdAt,
    List<List<String>> tags = const [],
    String content = 'hello',
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
  late List<RelayFrame> frames;
  late StreamSubscription<RelayFrame> _sub;

  setUp(() async {
    await EventStore.instance.debugReset();
    EventStore.debugOpenOverride = null;
    await openStore();
    relay = LocalRelay(store: EventStore.instance);
    frames = <RelayFrame>[];
    _sub = relay.frames.listen(frames.add);
  });

  tearDown(() async {
    await _sub.cancel();
    await relay.dispose();
    EventStore.debugOpenOverride = null;
    await EventStore.instance.debugReset();
  });

  /// Let async frames settle, then take everything collected so far.
  Future<List<RelayFrame>> drain([
    Duration settle = const Duration(milliseconds: 100),
  ]) async {
    await Future<void>.delayed(settle);
    final out = List<RelayFrame>.of(frames);
    frames.clear();
    return out;
  }

  test('REQ → stored EVENTs then EOSE', () async {
    final e1 = signed(privkey: h(1), kind: 1, content: 'first');
    final e2 = signed(privkey: h(2), kind: 1, content: 'second');
    await EventStore.instance.ingest([e1, e2]);

    await relay.req(session, 'sub1', [NostrFilter(kinds: [1])]);
    final got = await drain();

    final events = got.where((f) => f.type == 'EVENT').toList();
    expect(events.length, 2);
    expect(got.last.type, 'EOSE');
    expect(got.last.payload, ['EOSE', 'sub1']);
  });

  test('REQ filters stored results (authors)', () async {
    final mine = signed(privkey: h(1), kind: 1);
    final theirs = signed(privkey: h(2), kind: 1);
    await EventStore.instance.ingest([mine, theirs]);

    await relay.req(session, 'sub', [
      NostrFilter(kinds: [1], authors: [mine.pubkey]),
    ]);
    final got = await drain();
    final events = got.where((f) => f.type == 'EVENT').toList();
    expect(events.length, 1);
    expect((events.first.payload[2] as Map)['pubkey'], mine.pubkey);
  });

  test('live fan-out: an event after EOSE reaches matching subs only', () async {
    await relay.req(session, 'watch1', [NostrFilter(kinds: [1])]);
    await relay.req(session, 'watch7', [NostrFilter(kinds: [7])]);
    await drain(); // EOSE for both

    final note = signed(privkey: h(3), kind: 1, content: 'live');
    relay.onEvent(note);
    final got = await drain();

    final live = got.where((f) => f.type == 'EVENT').toList();
    expect(live.length, 1);
    expect(live.first.payload[1], 'watch1'); // kind-7 sub got nothing
  });

  test('live fan-out respects #p tag subscriptions', () async {
    final me = signed(privkey: h(5), kind: 1);
    await relay.req(session, 'mentions', [
      NostrFilter(kinds: [1], tagFilters: {'p': [me.pubkey]}),
    ]);
    await drain();

    final mentionsMe = signed(
      privkey: h(6),
      kind: 1,
      tags: [['p', me.pubkey]],
    );
    final notMe = signed(privkey: h(7), kind: 1);
    relay.onEvent(mentionsMe);
    relay.onEvent(notMe);
    final got = await drain();

    final live = got.where((f) => f.type == 'EVENT').toList();
    expect(live.length, 1);
    expect((live.first.payload[2] as Map)['id'], mentionsMe.id);
  });

  test('a duplicate event is not delivered twice to the same sub', () async {
    await relay.req(session, 'sub', [NostrFilter(kinds: [1])]);
    await drain();
    final note = signed(privkey: h(8), kind: 1);
    relay.onEvent(note);
    relay.onEvent(note); // same id again
    final got = await drain();
    expect(got.where((f) => f.type == 'EVENT').length, 1);
  });

  test('CLOSE stops live delivery', () async {
    await relay.req(session, 'sub', [NostrFilter(kinds: [1])]);
    await drain();
    relay.close(session, 'sub');
    relay.onEvent(signed(privkey: h(9), kind: 1));
    final got = await drain();
    expect(got.where((f) => f.type == 'EVENT'), isEmpty);
  });

  test('a REQ on an existing sub id replaces it', () async {
    await relay.req(session, 'sub', [NostrFilter(kinds: [1])]);
    await drain();
    await relay.req(session, 'sub', [NostrFilter(kinds: [7])]);
    await drain();
    relay.onEvent(signed(privkey: h(10), kind: 1)); // old sub's kind
    relay.onEvent(signed(privkey: h(10), kind: 7)); // new sub's kind
    final got = await drain();
    final live = got.where((f) => f.type == 'EVENT').toList();
    expect(live.length, 1);
    expect((live.first.payload[2] as Map)['kind'], 7);
  });

  test('client EVENT: valid → OK true + stored + fanned out', () async {
    await relay.req(session, 'watch', [NostrFilter(kinds: [1])]);
    await drain();
    final note = signed(privkey: h(11), kind: 1, content: 'published');
    await relay.onClientEvent(session, note);
    final got = await drain();

    final ok = got.firstWhere((f) => f.type == 'OK');
    expect(ok.payload, [ 'OK', note.id, true, '' ]);
    expect(await EventStore.instance.eventById(note.id), isNotNull);
    expect(got.where((f) => f.type == 'EVENT' && f.payload[1] == 'watch').length, 1);
  });

  test('client EVENT: forged signature → OK false, not stored', () async {
    final note = signed(privkey: h(12), kind: 1);
    final forged = NostrEvent(
      id: note.id,
      pubkey: note.pubkey,
      createdAt: note.createdAt,
      kind: note.kind,
      tags: note.tags,
      content: 'tampered', // content changed → id no longer commits
      sig: note.sig,
    );
    await relay.onClientEvent(session, forged);
    final got = await drain();
    final ok = got.firstWhere((f) => f.type == 'OK');
    expect(ok.payload[2], isFalse);
    expect(ok.payload[3] as String, startsWith('invalid:'));
    expect(await EventStore.instance.eventById(note.id), isNull);
  });

  test('REQ with an empty-list filter answers EOSE, never matches', () async {
    await relay.req(session, 'dead', [NostrFilter(tagFilters: {'e': []})]);
    final got = await drain();
    expect(got.single.type, 'EOSE');
    relay.onEvent(signed(privkey: h(13), kind: 1, tags: [['e', h(1)]]));
    final after = await drain();
    expect(after.where((f) => f.type == 'EVENT'), isEmpty);
  });

  test('limit bounds the initial query', () async {
    for (var i = 0; i < 5; i++) {
      await EventStore.instance
          .ingest([signed(privkey: h(20 + i), kind: 1, content: 'n$i')]);
    }
    await relay.req(session, 'sub', [NostrFilter(kinds: [1], limit: 2)]);
    final got = await drain();
    expect(got.where((f) => f.type == 'EVENT').length, 2);
    expect(got.last.type, 'EOSE');
  });

  test('closeSession tears down every sub the session owned', () async {
    await relay.req(session, 'a', [NostrFilter(kinds: [1])]);
    await relay.req(session, 'b', [NostrFilter(kinds: [7])]);
    await drain();
    expect(relay.subscriptionCount, 2);
    relay.closeSession(session);
    expect(relay.subscriptionCount, 0);
    relay.onEvent(signed(privkey: h(30), kind: 1));
    final got = await drain();
    expect(got.where((f) => f.type == 'EVENT'), isEmpty);
  });

  test('time-only subscriptions are live candidates (catch-all)', () async {
    await relay.req(session, 'time', [NostrFilter(since: 0)]);
    await drain();
    relay.onEvent(signed(privkey: h(31), kind: 1));
    final got = await drain();
    expect(got.where((f) => f.type == 'EVENT').length, 1);
  });
}
