import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/providers/content_providers.dart';
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
  final notifier = ref.read(engagementVersionProvider.notifier);

  // Debounced engagement tick (Amethyst's sampleTime=500): a burst of
  // likes/zaps = ONE version bump = one wave of row-scoped recounts, not a
  // rebuild storm per event.
  Timer? engagementTick;
  void bumpEngagement() {
    engagementTick?.cancel();
    engagementTick = Timer(_engagementTickDelay, () => notifier.state++);
  }

  final sub = bus.stream.listen((event) {
    // DM kinds belong to the DmStore decrypt pipeline — never stored raw
    // here (gift wraps are undecryptable ciphertext + randomized timestamps;
    // the DM feature owns their lifecycle).
    if (_dmKinds.contains(event.kind)) return;

    unawaited(EventStore.instance.ingest([event]));

    // Engagement kinds carrying e-tags change post counts.
    if (_engagementKinds.contains(event.kind) && event.eventRefs.isNotEmpty) {
      bumpEngagement();
    }
  });

  ref.onDispose(() {
    engagementTick?.cancel();
    unawaited(sub.cancel());
  });
});

/// Kinds the pipeline stores + counts as engagement. Mirrors the page-level
/// `_syncEngagement` filter so live and batched engagement agree.
const _engagementKinds = [1, 6, 7, 16, 9735, 1111];

/// DM kinds (NIP-04 legacy + NIP-17 gift wrap) — owned by DmStore.
const _dmKinds = [4, 1059];

/// Debounce window for the engagement version tick.
const _engagementTickDelay = Duration(milliseconds: 500);
