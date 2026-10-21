import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

/// Kind-7 reactions AUTHORED BY a pubkey (the posts they liked).
/// The profile "Likes" tab shows these — NOT kind-7 events in their feed
/// (users don't post reactions to their own feed, so that was always empty).
final userLikesProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, String>(
        (ref, pubkey) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final reactions = await nostr.relayPool.query([
    NostrFilter(kinds: [7], authors: [pubkey], limit: 100),
  ], timeout: const Duration(seconds: 8));
  reactions.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return reactions;
});

/// The posts a user liked, resolved from their kind-7 reactions' e tags.
/// Returns the actual liked POST events (kind 1 etc.), newest first.
final userLikedPostsProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, String>(
        (ref, pubkey) async {
  final reactions = await ref.watch(userLikesProvider(pubkey).future);
  final ids = <String>[];
  final seen = <String>{};
  for (final r in reactions) {
    final target = r.getTag('e');
    if (target != null && seen.add(target)) ids.add(target);
  }
  if (ids.isEmpty) return [];
  final nostr = ref.read(nostrServiceProvider);
  final posts = await nostr.fetchEventsByIds(ids.take(50).toList());
  // Keep reaction order (most recently liked first).
  final byId = {for (final p in posts) p.id: p};
  return ids.map((id) => byId[id]).whereType<NostrEvent>().toList();
});

/// Pubkeys a user FOLLOWS (their kind-3 follow list).
final followingListProvider =
    FutureProvider.autoDispose.family<List<String>, String>(
        (ref, pubkey) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.fetchFollows(pubkey);
});

/// Pubkeys that follow a user (kind-3 events p-tagging them).
final followersListProvider =
    FutureProvider.autoDispose.family<List<String>, String>(
        (ref, pubkey) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.fetchFollowers(pubkey);
});

/// Communities a user joined (kind 10004 coordinates → definition events).
final joinedCommunitiesProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, String>(
        (ref, pubkey) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final listEvents = await nostr.relayPool.query([
    NostrFilter(kinds: [10004], authors: [pubkey], limit: 5),
  ], timeout: const Duration(seconds: 6));
  final coords = <String>{};
  for (final e in listEvents) {
    for (final tag in e.tags) {
      if (tag.isNotEmpty && tag[0] == 'a' && tag.length > 1) {
        coords.add(tag[1]);
      }
    }
  }
  if (coords.isEmpty) return [];
  // Resolve each coordinate (34550:pubkey:d) to its definition event.
  final defs = <NostrEvent>[];
  final seen = <String>{};
  for (final coord in coords) {
    final parts = coord.split(':');
    if (parts.length < 3) continue;
    final events = await nostr.relayPool.query([
      NostrFilter(
        kinds: [34550],
        authors: [parts[1]],
        tagFilters: {
          'd': [parts.sublist(2).join(':')],
        },
        limit: 1,
      ),
    ], timeout: const Duration(seconds: 4));
    if (events.isNotEmpty && seen.add(events.first.id)) {
      defs.add(events.first);
    }
  }
  return defs;
});

/// Communities a user CREATED (kind 34550 they authored).
final myCommunitiesProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, String>(
        (ref, pubkey) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.relayPool.query([
    NostrFilter(kinds: [34550], authors: [pubkey], limit: 50),
  ], timeout: const Duration(seconds: 6));
});
