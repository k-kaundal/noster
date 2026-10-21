import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

/// All calendar events (NIP-52 kind 31922/31923), newest first.
final calendarEventsProvider =
    FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.fetchCalendarEvents();
});

/// Upcoming events only (start >= now), sorted by start time ascending.
final upcomingEventsProvider =
    FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final events = await ref.watch(calendarEventsProvider.future);
  final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
  final upcoming = events.where((e) {
    final start =
        int.tryParse(e.getTag('start') ?? '') ?? e.createdAt;
    return start >= now - 86400; // include today's
  }).toList();
  upcoming.sort(
    (a, b) => (int.tryParse(a.getTag('start') ?? '') ?? a.createdAt)
        .compareTo(int.tryParse(b.getTag('start') ?? '') ?? b.createdAt),
  );
  return upcoming;
});

/// RSVP responses (kind 31925) for one calendar event coordinate.
final rsvpsProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, String>(
        (ref, coordinate) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.relayPool.query([
    NostrFilter(
      kinds: [31925],
      tagFilters: {
        'a': [coordinate],
      },
      limit: 200,
    ),
  ], timeout: const Duration(seconds: 6));
});

/// The current user's RSVP status for a calendar event ('accepted',
/// 'tentative', 'declined', or null). Per NIP-52, latest RSVP wins.
final myRsvpProvider =
    FutureProvider.autoDispose.family<String?, String>((ref, coordinate) async {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return null;
  final rsvps = await ref.watch(rsvpsProvider(coordinate).future);
  final mine = rsvps.where((e) => e.pubkey == auth.pubkey).toList();
  if (mine.isEmpty) return null;
  mine.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return mine.first.getTag('status');
});

/// RSVP counts for a calendar event coordinate:
/// (accepted, tentative, declined) — latest per pubkey.
final rsvpCountsProvider = FutureProvider.autoDispose
    .family<({int accepted, int tentative, int declined}), String>(
        (ref, coordinate) async {
  final rsvps = await ref.watch(rsvpsProvider(coordinate).future);
  final latestByPubkey = <String, String>{};
  for (final e in rsvps) {
    latestByPubkey[e.pubkey] = e.getTag('status') ?? '';
  }
  var accepted = 0, tentative = 0, declined = 0;
  for (final status in latestByPubkey.values) {
    switch (status) {
      case 'accepted':
        accepted++;
      case 'tentative':
        tentative++;
      case 'declined':
        declined++;
    }
  }
  return (accepted: accepted, tentative: tentative, declined: declined);
});
