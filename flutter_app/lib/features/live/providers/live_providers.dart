import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/live/models/live_event.dart';

/// All live activities (NIP-53 kind 30311), deduped by d tag, live first.
final liveEventsProvider = FutureProvider.autoDispose<List<LiveEvent>>((ref) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final events = await nostr.fetchLiveStreams(limit: 60);
  // Dedupe by d tag (addressable — newest version wins).
  final byD = <String, NostrEvent>{};
  for (final e in events) {
    final d = e.getTag('d') ?? '';
    final existing = byD[d];
    if (existing == null || e.createdAt > existing.createdAt) byD[d] = e;
  }
  final lives = byD.values.map(LiveEvent.fromEvent).toList();
  // Live first, then planned (soonest), then ended (most recent).
  lives.sort((a, b) {
    int rank(LiveEvent e) => switch (e.status) {
          LiveStatus.live => 0,
          LiveStatus.planned => 1,
          LiveStatus.ended => 2,
        };
    final r = rank(a).compareTo(rank(b));
    if (r != 0) return r;
    if (a.status == LiveStatus.planned) {
      return (a.starts ?? 0).compareTo(b.starts ?? 0); // soonest first
    }
    return b.updatedAt.compareTo(a.updatedAt);
  });
  return lives;
});

/// Currently-live activities only.
final nowLiveProvider = FutureProvider.autoDispose<List<LiveEvent>>((ref) async {
  final all = await ref.watch(liveEventsProvider.future);
  return all.where((e) => e.isLive).toList();
});

/// Live chat messages for one activity coordinate (newest first).
final liveChatProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, String>(
        (ref, coordinate) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.fetchLiveChat(coordinate);
});
