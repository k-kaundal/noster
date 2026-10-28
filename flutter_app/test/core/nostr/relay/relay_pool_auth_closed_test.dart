import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_frame_processor.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';

/// Regression test for the "DMs never arrive in realtime" bug:
/// strfry (`restrictReadToInvolvedPubkey`) answers a DM-kind REQ that raced
/// the NIP-42 handshake with CLOSED "auth-required". The old dispatch tore
/// the subscription DOWN (EOSE completed, stream closed) — the live DM
/// stream (kinds 4/1059) died on every cold start, only reviving on an
/// unrelated socket reconnect hours later.
///
/// The fix: an "auth-required" CLOSED for a PERSISTENT sub re-queues the
/// REQ for the post-AUTH flush instead of tearing the sub down.
void main() {
  NostrFilter dmFilter(String pubkey) => NostrFilter(
        kinds: const [4, 1059],
        tagFilters: {
          'p': [pubkey],
        },
      );

  test(
    'auth-required CLOSED on a persistent sub re-queues the REQ (no teardown)',
    () {
      final conn = RelayConnection('wss://relay.example');
      final (subId, stream) = conn.debugRegisterPersistentSub([
        dmFilter('a' * 64),
      ]);
      var streamClosed = false;
      stream.listen((_) {}, onDone: () => streamClosed = true);

      expect(conn.debugPendingAuthReqCount, 0);

      // strfry's answer to a pre-auth DM REQ: CLOSED auth-required.
      conn.debugDispatchFrame(
        ClosedRelayFrame(subId, 'auth-required: requested filter requires authentication'),
      );

      // The REQ must be queued for the post-AUTH flush, and the stream must
      // still be alive (re-issued REQ delivers into it after auth).
      expect(conn.debugPendingAuthReqCount, 1);
      expect(streamClosed, isFalse);
    },
  );

  test('a repeated auth-required CLOSED does not stack duplicate REQs', () {
    final conn = RelayConnection('wss://relay.example');
    final (subId, _) = conn.debugRegisterPersistentSub([
      dmFilter('b' * 64),
    ]);

    const msg = 'auth-required: requested filter requires authentication';
    conn.debugDispatchFrame(ClosedRelayFrame(subId, msg));
    conn.debugDispatchFrame(ClosedRelayFrame(subId, msg));
    conn.debugDispatchFrame(ClosedRelayFrame(subId, msg));

    expect(conn.debugPendingAuthReqCount, 1); // deduped, not 3
  });

  test(
    'a non-auth CLOSED still tears the sub down (normal relay behavior kept)',
    () async {
      final conn = RelayConnection('wss://relay.example');
      final (subId, stream) = conn.debugRegisterPersistentSub([
        dmFilter('c' * 64),
      ]);
      var streamClosed = false;
      stream.listen((_) {}, onDone: () => streamClosed = true);

      // e.g. rate-limited / blocked / malformed — terminal for the sub.
      conn.debugDispatchFrame(ClosedRelayFrame(subId, 'blocked: blocked'));

      expect(conn.debugPendingAuthReqCount, 0); // NOT queued
      // Allow the broadcast stream's onDone to fire.
      await Future<void>.delayed(Duration.zero);
      expect(streamClosed, isTrue);
    },
  );

  test(
    'a one-shot query closed with auth-required is NOT re-queued (no persistent sub)',
    () {
      final conn = RelayConnection('wss://relay.example');
      // A one-shot REQ never registers in _persistentSubs — the caller
      // re-queries explicitly (gap-fill / refresh), nothing to resurrect.
      conn.debugDispatchFrame(
        const ClosedRelayFrame(
          'oneshot1',
          'auth-required: requested filter requires authentication',
        ),
      );
      expect(conn.debugPendingAuthReqCount, 0);
    },
  );
}
