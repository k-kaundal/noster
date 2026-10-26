import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/nostr_service_providers.dart';

/// ADR-0005 L4 — the ingest pipeline: EVERY event that passes the bus gates
/// lands in the local store, exactly once. This is the single write path
/// that makes "UI reads only the store" possible (Damus's local-relay
/// model): feed pages, threads, counts, and (in P4/P5) trending/explore all
/// project from these rows.
///
/// Before this, live-tail ingestion was a side effect inside FeedNotifier
/// and engagement only landed via page-level `_syncEngagement` one-shots —
/// so a like arriving on the social listener never reached the engagement
/// index until the next page fetch. Now any engagement event on ANY bus
/// spec indexes immediately, and counts update live.
///
/// Watch once at the app root (app.dart).
final ingestPipelineProvider = Provider<void>((ref) {
  final bus = ref.watch(eventBusProvider);
  // ADR-0007: mirror every stored event into the local relay's live monitor
  // so its view of the store stays current (the merged transport's local
  // half emits these). Enabled flag off → relay is null, nothing mirrored.
  final localRelay = ref.watch(localRelayEnabledProvider)
      ? ref.watch(localRelayProvider)
      : null;

  // Batched ingest: a burst (page replay, reconnect resubscribe flood —
  // much bigger on Android, which kills idle sockets) used to run
  // `ingest([event])` PER EVENT — one SQLite transaction + deletion-check
  // query each, 50+ txns per burst, janking the UI isolate. Buffer for a
  // short window and write ONE transaction per burst instead. 150 ms is
  // invisible next to relay latency; the store stays the source of truth.
  //
  // ADR-0008 P5: the engagement tick is GONE from here — the store's writer
  // lane now reports WHICH tables changed after each commit (via
  // `EventStore.onTablesChanged` → the invalidation bus), and
  // `engagementVersionProvider` DERIVES from `StoreTable.eventRefs`. One
  // source of truth (the store's commit), scoped per table, debounced there.
  final pending = <NostrEvent>[];
  Timer? flushTimer;
  bool flushing = false;
  Future<void> flush() async {
    flushTimer?.cancel();
    flushTimer = null;
    if (flushing) return; // a new timer is scheduled per arrival while busy
    if (pending.isEmpty) return;
    flushing = true;
    try {
      while (pending.isNotEmpty) {
        final batch = pending.length > _ingestBatchMax
            ? pending.sublist(0, _ingestBatchMax)
            : pending.toList();
        pending.removeRange(0, batch.length);
        await EventStore.instance.ingest(batch);
      }
    } finally {
      flushing = false;
    }
  }

  final sub = bus.stream.listen((event) {
    // DM kinds belong to the DmStore decrypt pipeline — never stored raw
    // here (gift wraps are undecryptable ciphertext + randomized timestamps;
    // the DM feature owns their lifecycle).
    if (_dmKinds.contains(event.kind)) return;

    pending.add(event);
    flushTimer ??= Timer(_ingestBatchWindow, flush);

    // ADR-0007: fan the event into the local relay (live subscribers get it
    // instantly — zero network). The store write above remains the source of
    // truth; this is only the relay's live monitor.
    localRelay?.onEvent(event);
  });

  ref.onDispose(() {
    flushTimer?.cancel();
    unawaited(sub.cancel());
  });
});

/// DM kinds (NIP-04 legacy + NIP-17 gift wrap) — owned by DmStore.
const _dmKinds = [4, 1059];

/// Ingest batching: events arriving within this window land in ONE SQLite
/// transaction (a page replay / reconnect burst = one txn, not fifty).
const _ingestBatchWindow = Duration(milliseconds: 150);

/// Safety cap on a single batched ingest (a huge replay splits into
/// sequential txns instead of one multi-thousand-row batch).
const _ingestBatchMax = 200;
