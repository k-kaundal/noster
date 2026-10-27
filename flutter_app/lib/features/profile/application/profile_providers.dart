import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

/// Kind-7 reactions AUTHORED BY a pubkey (the posts they liked).
/// The profile "Likes" tab shows these — NOT kind-7 events in their feed
/// (users don't post reactions to their own feed, so that was always empty).
///
/// STORE-FIRST: reactions we've already ingested (from engagement batches)
/// paint instantly; the relay fetch backfills.
final userLikesProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, String>(
        (ref, pubkey) async {
  // Store-first: reactions from engagement batches render instantly.
  final stored = await EventStore.instance.queryByFilters([
    NostrFilter(kinds: [7], authors: [pubkey], limit: 100),
  ]);
  if (stored.isNotEmpty) {
    stored.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  try {
    final nostr = ref.read(nostrServiceProvider);
    if (!nostr.isInitialized) await nostr.init();
    final fresh = await nostr.relayPool.query([
      NostrFilter(kinds: [7], authors: [pubkey], limit: 100),
    ], timeout: const Duration(seconds: 8));
    if (fresh.isNotEmpty) {
      unawaited(EventStore.instance.ingest(fresh));
      if (stored.isNotEmpty) {
        final seen = stored.map((e) => e.id).toSet();
        return [
          ...stored,
          ...fresh.where((e) => !seen.contains(e.id)),
        ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      }
      fresh.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      return fresh;
    }
  } catch (_) {
    // Offline — the stored paint (if any) stands.
  }
  return stored;
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
/// STORE-FIRST: cached follows from the store paint instantly, relay backfills.
final followingListProvider =
    FutureProvider.autoDispose.family<List<String>, String>(
        (ref, pubkey) async {
  // Store-first: the profile cache may already have the follow list.
  final nostr = ref.read(nostrServiceProvider);
  final cached = nostr.followsCache[pubkey];
  if (cached != null) return cached.follows;

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
///
/// STORE-FIRST: the user's kind-10004 list + kind-34550 definitions already
/// in the store paint instantly; the relay fetch backfills. The old path was
/// 1 + N sequential relay queries (one per community) — up to N×4s before
/// first paint.
final joinedCommunitiesProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, String>(
        (ref, pubkey) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();

  // 1. Read the communities list (kind 10004) — store first.
  final listFilter = NostrFilter(kinds: [10004], authors: [pubkey], limit: 5);
  final storedList = await EventStore.instance.queryByFilters([listFilter]);
  List<NostrEvent> listEvents = storedList;
  if (storedList.isEmpty) {
    listEvents = await nostr.relayPool.query([listFilter],
        timeout: const Duration(seconds: 6));
    if (listEvents.isNotEmpty) {
      unawaited(EventStore.instance.ingest(listEvents));
    }
  }

  final coords = <String>{};
  for (final e in listEvents) {
    for (final tag in e.tags) {
      if (tag.isNotEmpty && tag[0] == 'a' && tag.length > 1) {
        coords.add(tag[1]);
      }
    }
  }
  if (coords.isEmpty) return [];

  // 2. Resolve each coordinate (34550:pubkey:d) — store first, in PARALLEL
  // (was a sequential per-coordinate relay loop).
  final defs = <NostrEvent>[];
  final seen = <String>{};
  final unresolved = <String>[];
  for (final coord in coords) {
    final parts = coord.split(':');
    if (parts.length < 3) continue;
    final stored = await EventStore.instance.queryByFilters([
      NostrFilter(
        kinds: [34550],
        authors: [parts[1]],
        tagFilters: {'d': [parts.sublist(2).join(':')]},
        limit: 1,
      ),
    ]);
    if (stored.isNotEmpty && seen.add(stored.first.id)) {
      defs.add(stored.first);
    } else {
      unresolved.add(coord);
    }
  }

  // Relay backfill for the ones the store doesn't have yet — parallel.
  if (unresolved.isNotEmpty) {
    final fetched = await Future.wait([
      for (final coord in unresolved)
        () async {
          final parts = coord.split(':');
          return nostr.relayPool.query([
            NostrFilter(
              kinds: [34550],
              authors: [parts[1]],
              tagFilters: {'d': [parts.sublist(2).join(':')]},
              limit: 1,
            ),
          ], timeout: const Duration(seconds: 4));
        }(),
    ]);
    final fresh = <NostrEvent>[];
    for (final events in fetched) {
      if (events.isNotEmpty && seen.add(events.first.id)) {
        defs.add(events.first);
        fresh.add(events.first);
      }
    }
    if (fresh.isNotEmpty) unawaited(EventStore.instance.ingest(fresh));
  }
  return defs;
});

/// Communities a user CREATED (kind 34550 they authored).
///
/// STORE-FIRST: definitions in the store paint instantly; relay backfills.
final myCommunitiesProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, String>(
        (ref, pubkey) async {
  final filter = NostrFilter(kinds: [34550], authors: [pubkey], limit: 50);
  final stored = await EventStore.instance.queryByFilters([filter]);
  if (stored.isNotEmpty) {
    stored.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    // Refresh behind: relay merge lands on the next rebuild.
    unawaited(() async {
      try {
        final nostr = ref.read(nostrServiceProvider);
        if (!nostr.isInitialized) await nostr.init();
        final fresh = await nostr.relayPool.query([filter],
            timeout: const Duration(seconds: 6));
        if (fresh.isNotEmpty) {
          await EventStore.instance.ingest(fresh);
        }
      } catch (_) {}
    }());
    return stored;
  }

  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final fresh = await nostr.relayPool.query([filter],
      timeout: const Duration(seconds: 6));
  if (fresh.isNotEmpty) {
    unawaited(EventStore.instance.ingest(fresh));
    fresh.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }
  return fresh;
});
