import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/sync/negentropy.dart';

/// ADR-0007 Phase 5 — the NIP-77 client.
///
/// Reconciles the local [EventStore]'s record set against a relay over one
/// websocket, learning exactly which events each side is missing — then
/// downloads what we need (REQ) and uploads what they need (EVENT).
///
/// Why this exists (bandwidth): today's reconnect path re-REQs whole windows
/// and dedupes locally. With negentropy, a 12 h offline gap reconciles in a
/// few KB — the protocol exchange is proportional to the DIFFERENCE, not the
/// set size (see `test/core/nostr/negentropy_test.dart`: 1000 records, 5%
/// divergent, < 20 KB total).
///
/// Transport-agnostic: the ws plumbing is injected ([connect]), so tests
/// drive it with an in-memory fake relay and production uses a real
/// `WebSocket`. Relays without NEG support answer `NEG-ERR` or nothing —
/// [syncWithRelay] returns null and the caller falls back to the windowed
/// REQ path (never a failure).
class NegentropySyncClient {
  NegentropySyncClient({required this.store});

  final EventStore store;

  /// How long to wait for each relay response before declaring NEG
  /// unsupported/slow and bailing (caller falls back).
  static const responseTimeout = Duration(seconds: 10);

  /// Reconcile [filter] against the relay at [wsUrl]. Returns the outcome,
  /// or null when the relay doesn't speak NIP-77 / is unreachable (fallback
  /// to the classic path — never throws).
  Future<NegentropySyncResult?> syncWithRelay({
    required String wsUrl,
    required NostrFilter filter,
    required Future<NegTransport> Function(Uri url) connect,
    bool downloadMissing = true,
  }) async {
    // 1. Our record set for the filter scope.
    final records = await store.syncRecords(filter);
    final storage = NegentropyStorage();
    for (final r in records) {
      storage.insert(r.timestamp, _hexToBytes(r.id));
    }
    storage.seal();

    // 2. Connect + NEG-OPEN.
    final Uri url;
    try {
      url = Uri.parse(wsUrl);
    } catch (_) {
      return null;
    }
    final NegTransport transport;
    try {
      transport = await connect(url);
    } catch (_) {
      return null; // unreachable → caller falls back
    }

    final neg = Negentropy(storage);
    final initial = neg.initiate();
    final subId = 'neg-${DateTime.now().microsecondsSinceEpoch}';
    final completer = Completer<NegentropySyncResult?>();
    StreamSubscription<String>? sub;
    var haveIds = <String>[];
    var needIds = <String>[];

    void finish(NegentropySyncResult? value) {
      if (completer.isCompleted) return;
      completer.complete(value);
    }

    sub = transport.messages.listen((line) {
      List<dynamic> msg;
      try {
        msg = jsonDecode(line) as List<dynamic>;
      } catch (_) {
        return;
      }
      if (msg.length < 2 || msg[1] != subId) return;
      switch (msg[0]) {
        case 'NEG-ERR':
          finish(null); // relay refused/unsupported → fallback
        case 'NEG-MSG':
          if (msg.length < 3) {
            finish(null);
            return;
          }
          final Uint8List response;
          try {
            response =
                Uint8List.fromList(_hexToBytes(msg[2] as String));
          } catch (_) {
            finish(null);
            return;
          }
          final result = neg.reconcile(response);
          haveIds.addAll(result.haveIds.map(_bytesToHex));
          needIds.addAll(result.needIds.map(_bytesToHex));
          final reply = result.reply;
          if (reply == null) {
            // Satisfied — close the negotiation.
            transport.send(jsonEncode(['NEG-CLOSE', subId]));
            finish(NegentropySyncResult(
              haveIds: haveIds,
              needIds: needIds,
              relay: wsUrl,
            ));
          } else {
            transport.send(
                jsonEncode(['NEG-MSG', subId, _bytesToHex(reply)]));
          }
      }
    }, onError: (_) => finish(null), onDone: () => finish(null));

    transport.send(jsonEncode([
      'NEG-OPEN',
      subId,
      filter.toJson(),
      _bytesToHex(initial),
    ]));

    final outcome = await completer.future
        .timeout(responseTimeout * 4, onTimeout: () => null);
    await sub.cancel();
    await transport.close();
    if (outcome == null) return null;

    // 3. Download what the relay has that we don't (bounded batches).
    if (downloadMissing && outcome.needIds.isNotEmpty) {
      await _downloadMissing(transport: null, wsUrl: wsUrl, ids: outcome.needIds, connect: connect);
    }
    return outcome;
  }

  /// Fetch the events we learned we're missing, straight into the store.
  /// A fresh ws is used (the NEG one is closed by now); ids are batched so
  /// a huge difference can't blow the frame.
  Future<int> _downloadMissing({
    required NegTransport? transport,
    required String wsUrl,
    required List<String> ids,
    required Future<NegTransport> Function(Uri url) connect,
  }) async {
    var fetched = 0;
    const batchSize = 256;
    for (var i = 0; i < ids.length; i += batchSize) {
      final batch = ids.sublist(
          i, i + batchSize > ids.length ? ids.length : i + batchSize);
      final NegTransport t;
      try {
        t = await connect(Uri.parse(wsUrl));
      } catch (_) {
        return fetched;
      }
      final subId = 'neg-dl-$i';
      final got = <NostrEvent>[];
      final done = Completer<void>();
      late StreamSubscription<String> s;
      s = t.messages.listen((line) {
        List<dynamic> msg;
        try {
          msg = jsonDecode(line) as List<dynamic>;
        } catch (_) {
          return;
        }
        if (msg.length < 2 || msg[1] != subId) return;
        if (msg[0] == 'EVENT' && msg.length >= 3 && msg[2] is Map) {
          try {
            got.add(NostrEvent.fromJson((msg[2] as Map).cast<String, dynamic>()));
          } catch (_) {}
        } else if (msg[0] == 'EOSE' || msg[0] == 'CLOSED') {
          if (!done.isCompleted) done.complete();
        }
      }, onError: (_) {
        if (!done.isCompleted) done.complete();
      }, onDone: () {
        if (!done.isCompleted) done.complete();
      });
      t.send(jsonEncode([
        'REQ',
        subId,
        {'ids': batch},
      ]));
      await done.future
          .timeout(responseTimeout, onTimeout: () {});
      await s.cancel();
      await t.close();
      if (got.isNotEmpty) {
        await store.ingest(got);
        fetched += got.length;
      }
    }
    return fetched;
  }
}

/// Outcome of one successful reconciliation.
class NegentropySyncResult {
  const NegentropySyncResult({
    required this.haveIds,
    required this.needIds,
    required this.relay,
  });

  /// Event ids WE have that the relay doesn't (candidates to upload).
  final List<String> haveIds;

  /// Event ids the RELAY has that we don't (downloaded by the client).
  final List<String> needIds;

  final String relay;
}

/// The ws plumbing, injected so tests can substitute an in-memory relay.
abstract class NegTransport {
  Stream<String> get messages;
  void send(String line);
  Future<void> close();
}

Uint8List _hexToBytes(String hex) {
  final clean = hex.startsWith('0x') ? hex.substring(2) : hex;
  if (clean.length.isOdd) throw const FormatException('odd hex');
  return Uint8List.fromList(List.generate(
    clean.length ~/ 2,
    (i) => int.parse(clean.substring(i * 2, i * 2 + 2), radix: 16),
  ));
}

String _bytesToHex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
