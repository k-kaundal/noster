import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/nostr/sync/negentropy.dart';

/// NIP-77 negentropy — protocol round-trip tests.
///
/// The decisive test: a client (initiator) and a server (responder), each
/// with its own record set, exchange real protocol messages until the
/// client is satisfied. The learned have/need sets must equal the exact
/// set difference — at any scale and with shared common ground.
void main() {
  Uint8List id(int seed) {
    final r = Random(seed);
    return Uint8List.fromList(List.generate(32, (_) => r.nextInt(256)));
  }

  String hexId(Uint8List b) =>
      b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();

  ({NegentropyStorage storage, Map<String, int> byKey}) store(
      List<({int ts, Uint8List id})> records) {
    final s = NegentropyStorage();
    final byKey = <String, int>{};
    for (final r in records) {
      s.insert(r.ts, r.id);
      byKey[hexId(r.id)] = r.ts;
    }
    s.seal();
    return (storage: s, byKey: byKey);
  }

  /// Run a full client↔server reconciliation. Returns (have, need) as hex
  /// id sets from the CLIENT's perspective.
  ({Set<String> have, Set<String> need, int rounds, int messageBytes})
      reconcile(
    NegentropyStorage client,
    NegentropyStorage server,
  ) {
    final c = Negentropy(client) /* initiator via initiate() */;
    final s = Negentropy(server);

    var message = c.initiate();
    final have = <String>{};
    final need = <String>{};
    var rounds = 0;
    var messageBytes = 0;

    while (true) {
      messageBytes += message.length;
      final sRes = s.reconcile(message);
      expect(sRes.reply, isNotNull,
          reason: 'responder always answers (version fallback aside)');
      messageBytes += sRes.reply!.length;
      final cRes = c.reconcile(sRes.reply!);
      have.addAll(cRes.haveIds.map(hexId));
      need.addAll(cRes.needIds.map(hexId));
      rounds++;
      if (cRes.reply == null) break; // client satisfied → NEG-CLOSE
      message = cRes.reply!;
      if (rounds > 64) fail('protocol did not converge');
    }
    return (have: have, need: need, rounds: rounds, messageBytes: messageBytes);
  }

  group('record storage', () {
    test('seal sorts by (timestamp, id); duplicates throw', () {
      final s = NegentropyStorage();
      s.insert(2000, id(1));
      s.insert(1000, id(2));
      s.seal();
      expect(s.getItem(0).timestamp, 1000);
      expect(s.getItem(1).timestamp, 2000);

      final dup = NegentropyStorage();
      final x = id(7);
      dup.insert(1000, x);
      dup.insert(1000, Uint8List.fromList(x));
      expect(dup.seal, throwsStateError);
    });
  });

  group('reconciliation', () {
    test('identical sets converge with an empty difference', () {
      final records = [
        for (var i = 0; i < 40; i++) (ts: 1000 + i * 10, id: id(i)),
      ];
      final a = store(records);
      final b = store(records);
      final res = reconcile(a.storage, b.storage);
      expect(res.have, isEmpty);
      expect(res.need, isEmpty);
      expect(res.rounds, lessThan(4));
    });

    test('client-only ids land in have, server-only ids in need', () {
      final common = [
        for (var i = 0; i < 30; i++) (ts: 1000 + i * 10, id: id(i)),
      ];
      final clientOnly = [
        (ts: 5000, id: id(1000)),
        (ts: 5001, id: id(1001)),
      ];
      final serverOnly = [
        (ts: 6000, id: id(2000)),
        (ts: 6001, id: id(2001)),
        (ts: 6002, id: id(2002)),
      ];
      final client = store([...common, ...clientOnly]);
      final server = store([...common, ...serverOnly]);

      final res = reconcile(client.storage, server.storage);
      expect(res.have, clientOnly.map((r) => hexId(r.id)).toSet());
      expect(res.need, serverOnly.map((r) => hexId(r.id)).toSet());
    });

    test('large interleaved difference (1000 records, 5% divergent)', () {
      final r = Random(42);
      final common = <({int ts, Uint8List id})>[];
      final clientOnly = <({int ts, Uint8List id})>[];
      final serverOnly = <({int ts, Uint8List id})>[];
      for (var i = 0; i < 1000; i++) {
        final rec = (ts: 1000 + i * 7, id: id(10000 + i));
        final roll = r.nextInt(100);
        if (roll < 95) {
          common.add(rec);
        } else if (roll < 98) {
          clientOnly.add(rec);
        } else {
          serverOnly.add(rec);
        }
      }
      final client = store([...common, ...clientOnly]);
      final server = store([...common, ...serverOnly]);

      final res = reconcile(client.storage, server.storage);
      expect(res.have, clientOnly.map((r) => hexId(r.id)).toSet());
      expect(res.need, serverOnly.map((r) => hexId(r.id)).toSet());
      // The whole point of negentropy: the exchange is tiny relative to the
      // 1000-record set (~64 KB of ids if transferred naively).
      expect(res.messageBytes, lessThan(20000));
    });

    test('one side empty: the other side\'s whole set is the difference', () {
      final full = store([
        for (var i = 0; i < 25; i++) (ts: 1000 + i * 10, id: id(500 + i)),
      ]);
      final empty = NegentropyStorage()..seal();

      // Client has everything, server has nothing.
      final res1 = reconcile(full.storage, empty);
      expect(res1.have.length, 25);
      expect(res1.need, isEmpty);

      // Client has nothing, server has everything.
      final res2 = reconcile(empty, full.storage);
      expect(res2.have, isEmpty);
      expect(res2.need.length, 25);
    });

    test('same timestamp, different ids disambiguate via id prefix', () {
      final ts = 7777;
      final a = (ts: ts, id: id(300));
      final b = (ts: ts, id: id(301));
      final c = (ts: ts, id: id(302));
      final client = store([a, b]);
      final server = store([b, c]);
      final res = reconcile(client.storage, server.storage);
      expect(res.have, {hexId(a.id)});
      expect(res.need, {hexId(c.id)});
    });
  });

  group('wire codec', () {
    test('messages start with the v1 protocol byte', () {
      final s = NegentropyStorage()..seal();
      final n = Negentropy(s);
      expect(n.initiate()[0], 0x61);
    });

    test('malformed input throws FormatException, not a crash', () {
      final s = NegentropyStorage()..seal();
      final n = Negentropy(s);
      expect(() => n.reconcile(Uint8List.fromList([0x61, 0xFF])),
          throwsFormatException);
      expect(() => n.reconcile(Uint8List.fromList([0x30])),
          throwsFormatException);
    });
  });
}
