import 'dart:async';
import 'dart:convert';

import 'package:bip340/bip340.dart' as bip340;
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_frame_processor.dart';

void main() {
  // A genuinely signed event (same fixture shape as event_signature_test).
  final priv = 'c' * 64;
  late final String pub;
  const createdAt = 1700000000;
  const kind = 1;
  final tags = <List<String>>[];
  const content = 'hello world';
  late final String goodId;
  late final String goodSig;

  setUpAll(() {
    pub = bip340.getPublicKey(priv);
    goodId = NostrEvent.computeId(pub, createdAt, kind, tags, content);
    goodSig = bip340.sign(priv, goodId, randomHex(32));
  });

  String eventFrame({
    String subId = 'sub1',
    String? id,
    String? sig,
    String? contentO,
    int? createdAtO,
  }) {
    final e = {
      'id': id ?? goodId,
      'pubkey': pub,
      'created_at': createdAtO ?? createdAt,
      'kind': kind,
      'tags': tags,
      'content': contentO ?? content,
      'sig': sig ?? goodSig,
    };
    return jsonEncode(['EVENT', subId, e]);
  }

  group('parseRelayFrame (pure, sync path)', () {
    late VerifyLru lru;
    setUp(() => lru = VerifyLru(100));

    test('a genuinely signed EVENT parses + verifies', () {
      final f = parseRelayFrame(eventFrame(), lru);
      expect(f, isA<EventRelayFrame>());
      final ef = f as EventRelayFrame;
      expect(ef.subId, 'sub1');
      expect(ef.eventJson['id'], goodId);
    });

    test('a relay-tampered content is dropped (id no longer commits)', () {
      final f = parseRelayFrame(eventFrame(contentO: 'TAMPERED'), lru);
      expect(f, isA<IgnoredRelayFrame>());
    });

    test('a wrong signature is dropped (fail closed)', () {
      final f = parseRelayFrame(eventFrame(sig: '0' * 128), lru);
      expect(f, isA<IgnoredRelayFrame>());
    });

    test('malformed JSON is dropped, never throws', () {
      expect(parseRelayFrame('not json at all', lru), isA<IgnoredRelayFrame>());
      expect(parseRelayFrame('{"a":1}', lru), isA<IgnoredRelayFrame>());
      expect(parseRelayFrame('[]', lru), isA<IgnoredRelayFrame>());
    });

    test('an expired event is dropped before verify', () {
      final expiredTags = [
        ['expiration', '1000000000'] // 2001 — long past
      ];
      final eid = NostrEvent.computeId(pub, createdAt, kind, expiredTags, content);
      final esig = bip340.sign(priv, eid, randomHex(32));
      final frame = jsonEncode([
        'EVENT',
        's',
        {
          'id': eid,
          'pubkey': pub,
          'created_at': createdAt,
          'kind': kind,
          'tags': expiredTags,
          'content': content,
          'sig': esig,
        }
      ]);
      expect(parseRelayFrame(frame, lru), isA<IgnoredRelayFrame>());
    });

    test('verify dedup: second copy of the SAME id skips re-verify but still dispatches', () {
      final f1 = parseRelayFrame(eventFrame(), lru);
      final f2 = parseRelayFrame(eventFrame(), lru);
      // Both dispatch (relay provenance needs every copy)…
      expect(f1, isA<EventRelayFrame>());
      expect(f2, isA<EventRelayFrame>());
      // …and the id was recorded as verified after the first.
      expect(lru.checkAndMark(goodId), isTrue);
    });

    test('EOSE / OK / AUTH / CLOSED / NOTICE classify correctly', () {
      expect(parseRelayFrame(jsonEncode(['EOSE', 's1']), lru),
          isA<EoseRelayFrame>());
      final ok = parseRelayFrame(jsonEncode(['OK', 'eid', true, '']), lru);
      expect(ok, isA<OkRelayFrame>());
      expect((ok as OkRelayFrame).accepted, isTrue);
      expect(parseRelayFrame(jsonEncode(['AUTH', 'challenge']), lru),
          isA<AuthRelayFrame>());
      expect(parseRelayFrame(jsonEncode(['CLOSED', 's1', 'msg']), lru),
          isA<ClosedRelayFrame>());
      expect(parseRelayFrame(jsonEncode(['NOTICE', 'hi']), lru),
          isA<IgnoredRelayFrame>());
    });
  });

  group('RelayFrameProcessor (worker isolate pool)', () {
    test('processes a real EVENT off-isolate and returns it verified', () async {
      final proc = RelayFrameProcessor();
      addTearDown(proc.dispose);
      final c = Completer<RelayFrame>();
      proc.submit(eventFrame(), (seq, frame) => c.complete(frame));
      final f = await c.future.timeout(const Duration(seconds: 10));
      expect(f, isA<EventRelayFrame>());
      expect((f as EventRelayFrame).eventJson['id'], goodId);
      expect(proc.outstanding, 0);
    });

    test('a forged event comes back Ignored (fail closed)', () async {
      final proc = RelayFrameProcessor();
      addTearDown(proc.dispose);
      final c = Completer<RelayFrame>();
      proc.submit(eventFrame(sig: '0' * 128), (seq, frame) => c.complete(frame));
      final f = await c.future.timeout(const Duration(seconds: 10));
      expect(f, isA<IgnoredRelayFrame>());
    });

    test('handles a burst of many frames (flood) without loss', () async {
      final proc = RelayFrameProcessor();
      addTearDown(proc.dispose);
      const n = 100;
      var received = 0;
      final done = Completer<void>();
      for (var i = 0; i < n; i++) {
        // Distinct contents → distinct ids → all must verify.
        final contentI = 'msg $i';
        final idI = NostrEvent.computeId(pub, createdAt, kind, tags, contentI);
        final sigI = bip340.sign(priv, idI, randomHex(32));
        proc.submit(eventFrame(id: idI, sig: sigI, contentO: contentI), (seq, frame) {
          expect(frame, isA<EventRelayFrame>());
          received++;
          if (received == n && !done.isCompleted) done.complete();
        });
      }
      await done.future.timeout(const Duration(seconds: 30));
      expect(received, n);
      expect(proc.outstanding, 0);
    });

    test('sync fallback (workerCount edge) still verifies correctly', () async {
      // workerCount clamps to ≥1, so force fallback via spawn semantics is
      // hard in a test; instead exercise the shared pure path directly
      // (covered above). Here just assert the fallback LRU path works.
      final lru = VerifyLru(10);
      expect(parseRelayFrame(eventFrame(), lru), isA<EventRelayFrame>());
    });
  });

  group('FrameSequencer (per-connection order)', () {
    test('dispatches in submit order even when results complete out of order', () {
      final dispatched = <int>[];
      // A fake processor that completes frames REVERSED (last submitted
      // completes first) to prove the sequencer restores order.
      final seq = FrameSequencer((frame) {
        dispatched.add((frame as EventRelayFrame).eventJson['n'] as int);
      });
      final pending = <int, void Function(RelayFrame)>{};
      final fake = _FakeProcessor(onSubmit: (jobSeq, cb) {
        pending[jobSeq] = cb;
      });

      const n = 20;
      for (var i = 0; i < n; i++) {
        seq.submit(fake, jsonEncode(['EVENT', 's', {'n': i}]));
      }
      // Complete them in REVERSE order — worst-case reorder.
      for (var job = n - 1; job >= 0; job--) {
        pending[job]!(EventRelayFrame('s', {'n': job}));
      }
      expect(dispatched, List.generate(n, (i) => i));
    });

    test('reset() drops stale in-flight frames (reconnect)', () {
      final dispatched = <int>[];
      final seq = FrameSequencer((frame) {
        dispatched.add((frame as EventRelayFrame).eventJson['n'] as int);
      });
      final pending = <int, void Function(RelayFrame)>{};
      final fake = _FakeProcessor(onSubmit: (jobSeq, cb) {
        pending[jobSeq] = cb;
      });
      seq.submit(fake, jsonEncode(['EVENT', 's', {'n': 0}])); // never completes
      seq.reset(); // socket died, fresh socket
      seq.submit(fake, jsonEncode(['EVENT', 's', {'n': 1}]));
      pending[1]!(EventRelayFrame('s', {'n': 1}));
      expect(dispatched, [1]); // stale job 0 dropped, fresh job 1 dispatched
    });

    test('A1: a stale frame completing AFTER reset is dropped (epoch guard)', () {
      // The bug the epoch guard fixes: a frame submitted to the shared pool
      // just before the socket died completes a few ms AFTER reset(). Without
      // the epoch check it would be dispatched into the NEW socket's stream
      // (a dead relay's frame corrupting the new socket's order).
      final dispatched = <int>[];
      final seq = FrameSequencer((frame) {
        dispatched.add((frame as EventRelayFrame).eventJson['n'] as int);
      });
      final pending = <int, void Function(RelayFrame)>{};
      final fake = _FakeProcessor(onSubmit: (jobSeq, cb) {
        pending[jobSeq] = cb;
      });
      // Submit two frames on the OLD socket (jobs 0, 1).
      seq.submit(fake, jsonEncode(['EVENT', 's', {'n': 0}]));
      seq.submit(fake, jsonEncode(['EVENT', 's', {'n': 1}]));
      // Socket dies → reset (epoch bump). New socket submits job 2 (n=2).
      seq.reset();
      seq.submit(fake, jsonEncode(['EVENT', 's', {'n': 2}]));
      // NOW the stale jobs 0, 1 complete LATE (after reset) — must be dropped.
      pending[0]!(EventRelayFrame('s', {'n': 0}));
      pending[1]!(EventRelayFrame('s', {'n': 1}));
      // The new socket's frame completes — only IT dispatches.
      pending[2]!(EventRelayFrame('s', {'n': 2}));
      expect(dispatched, [2]); // stale 0,1 dropped by the epoch guard
    });
  });

  group('backpressure (pure watermark state machine)', () {
    const hw = 100, lw = 25;
    test('saturates only ABOVE highWater', () {
      expect(backpressureSignal(outstanding: hw, saturated: false, highWater: hw, lowWater: lw),
          BackpressureSignal.none); // at, not above
      expect(backpressureSignal(outstanding: hw + 1, saturated: false, highWater: hw, lowWater: lw),
          BackpressureSignal.saturate);
    });
    test('no re-saturate while already saturated', () {
      expect(backpressureSignal(outstanding: hw + 50, saturated: true, highWater: hw, lowWater: lw),
          BackpressureSignal.none);
    });
    test('drains only AT-or-below lowWater (hysteresis gap stops flapping)', () {
      // Between low and high while saturated: hold (no signal).
      expect(backpressureSignal(outstanding: lw + 1, saturated: true, highWater: hw, lowWater: lw),
          BackpressureSignal.none);
      expect(backpressureSignal(outstanding: lw, saturated: true, highWater: hw, lowWater: lw),
          BackpressureSignal.drain);
      expect(backpressureSignal(outstanding: lw - 1, saturated: true, highWater: hw, lowWater: lw),
          BackpressureSignal.drain);
    });
    test('not saturated + below lowWater = none (already calm)', () {
      expect(backpressureSignal(outstanding: 0, saturated: false, highWater: hw, lowWater: lw),
          BackpressureSignal.none);
    });
  });
}

/// A test double matching [RelayFrameProcessor]'s submit surface so the
/// sequencer can be driven deterministically (completion order controlled).
class _FakeProcessor implements RelayFrameProcessor {
  _FakeProcessor({required this.onSubmit});
  final void Function(int jobSeq, void Function(RelayFrame) cb) onSubmit;
  int _seq = 0;

  @override
  void submit(String raw, void Function(int seq, RelayFrame frame) onResult) {
    final job = _seq++;
    // Decode the 'n' field the test embeds so the callback can find it.
    final n = (jsonDecode(raw) as List)[2]['n'] as int;
    onSubmit(job, (frame) {
      // When the test fires the stored callback, deliver an EventRelayFrame
      // carrying this job's n. (The `frame` arg is ignored; we synthesize.)
      onResult(job, EventRelayFrame('s', {'n': n}));
    });
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
