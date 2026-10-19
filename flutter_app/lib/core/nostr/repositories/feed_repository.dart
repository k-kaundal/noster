import 'dart:math';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';
import 'package:nostrfeed_mobile/core/nostr/repositories/engagement_repository.dart';

/// A trending hashtag with usage count.
class HashtagStat {
  final String tag;
  final int count;
  const HashtagStat({required this.tag, required this.count});
}

class FeedRepository {
  final RelayPool relayPool;
  final EngagementRepository engagement;
  FeedRepository(this.relayPool, this.engagement);

  Future<List<NostrEvent>> fetchFeed({
    int limit = 50,
    int? since,
    int? until,
    List<String>? authors,
  }) async {
    // Include: text notes, reposts, generic reposts, pictures, videos, articles
    final filter = NostrFilter(
      kinds: [1, 6, 16, 20, 21, 22, 30023],
      limit: limit,
      since: since,
      until: until,
      authors: authors,
    );
    final events = await relayPool.query([
      filter,
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  Future<List<NostrEvent>> fetchFollowingFeed(
    List<String> followedPubkeys, {
    int limit = 50,
    int? until,
  }) async {
    if (followedPubkeys.isEmpty) return [];
    return fetchFeed(limit: limit, until: until, authors: followedPubkeys);
  }

  /// Fetch NIP-22 comments (kind 1111) for a root event. For addressable
  /// roots pass the full `kind:pubkey:d` coordinate; for regular events pass
  /// the event id.
  Future<List<NostrEvent>> fetchComments(
    String idOrCoordinate, {
    bool isAddressable = false,
    int limit = 100,
  }) async {
    final filters = <NostrFilter>[];
    if (isAddressable) {
      filters.add(NostrFilter(
        kinds: [1111],
        tagFilters: {'A': [idOrCoordinate]},
        limit: limit,
      ));
      filters.add(NostrFilter(
        kinds: [1111],
        tagFilters: {'a': [idOrCoordinate]},
        limit: limit,
      ));
    } else {
      filters.add(NostrFilter(
        kinds: [1111],
        tagFilters: {'E': [idOrCoordinate]},
        limit: limit,
      ));
      filters.add(NostrFilter(
        kinds: [1111],
        tagFilters: {'e': [idOrCoordinate]},
        limit: limit,
      ));
    }
    final events = await relayPool.query(
      filters,
      timeout: const Duration(seconds: 8),
    );
    // Dedupe
    final seen = <String>{};
    final unique = events.where((e) => seen.add(e.id)).toList();
    unique.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return unique;
  }

  Future<List<NostrEvent>> fetchReplies(String eventId) async {
    return relayPool.query([
      NostrFilter(
        kinds: [1],
        tagFilters: {
          'e': [eventId],
        },
        limit: 100,
      ),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchReactions(String eventId) async {
    return relayPool.query([
      NostrFilter(
        kinds: [7],
        tagFilters: {
          'e': [eventId],
        },
        limit: 200,
      ),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchReposts(String eventId) async {
    return relayPool.query([
      NostrFilter(
        kinds: [6, 16],
        tagFilters: {
          'e': [eventId],
        },
        limit: 200,
      ),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchNotifications(
    String pubkey, {
    int limit = 50,
  }) async {
    // Notification kinds that target the user via p tag:
    // 1 = mention/reply, 6 = repost, 7 = reaction, 16 = generic repost,
    // 9735 = zap receipt, 1111 = NIP-22 comment, 1059 = NIP-17 DM,
    // 30023 = article mention, 31925 = calendar RSVP
    final events = await relayPool.query([
      NostrFilter(
        kinds: [1, 6, 7, 16, 9735, 1111, 1059, 30023, 31925],
        tagFilters: {
          'p': [pubkey],
        },
        limit: limit,
      ),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  Future<List<NostrEvent>> search(String query, {int limit = 50}) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [1], search: query, limit: limit),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  Future<List<NostrEvent>> fetchBookmarks(String pubkey) async {
    return relayPool.query([
      NostrFilter(kinds: [10003], authors: [pubkey], limit: 1),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchDMs(String pubkey, {int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [4, 1059], authors: [pubkey], limit: limit),
      NostrFilter(
        kinds: [4, 1059],
        tagFilters: {
          'p': [pubkey],
        },
        limit: limit,
      ),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchHashtagFeed(
    String tag, {
    int limit = 50,
  }) async {
    final events = await relayPool.query([
      NostrFilter(
        kinds: [1],
        tagFilters: {
          't': [tag.toLowerCase()],
        },
        limit: limit,
      ),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  Future<List<NostrEvent>> fetchCommunities({int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [34550], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchArticles({int limit = 50}) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [30023], limit: limit),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  /// Fetch trending posts sorted by engagement score (replies + reactions +
  /// reposts + zaps weighted by recency). Uses a time-decay algorithm similar
  /// to Hacker News / Reddit: score = (engagement + 1) / (age_hours + 2)^1.8.
  Future<List<NostrEvent>> fetchTrending({
    int limit = 50,
    int hours = 24,
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final since = now - (hours * 3600);

    // Fetch candidate posts from the time window
    final candidates = await relayPool.query([
      NostrFilter(
        kinds: [1, 20, 21, 22, 30023],
        since: since,
        limit: limit * 5, // Fetch extra to filter by engagement
      ),
    ], timeout: const Duration(seconds: 10));

    if (candidates.isEmpty) return [];

    // Fetch engagement for all candidates in one batched query
    final eventIds = candidates.map((e) => e.id).toList();
    final engagementMap = await engagement.fetchEngagementBatch(eventIds);

    // Score each event: engagement_score / age_decay
    final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final scored = candidates.map((event) {
      final engagement = engagementMap[event.id] ?? const EventEngagement();
      final ageSeconds = nowSeconds - event.createdAt;
      final ageHours = ageSeconds / 3600;

      // Hacker News style decay: score = (points + 1) / (age_hours + 2)^1.8
      final points = engagement.score + 1;
      final decay = pow(ageHours + 2, 1.8);
      final score = points / decay;

      return (event: event, score: score, engagement: engagement);
    }).toList();

    // Sort by score descending
    scored.sort((a, b) => b.score.compareTo(a.score));

    // Return top N, filtering out low-engagement posts
    return scored
        .where((s) => s.engagement.score > 0 || s.event.createdAt > since)
        .take(limit)
        .map((s) => s.event)
        .toList();
  }

  Future<List<NostrEvent>> fetchLists(String pubkey) async {
    return relayPool.query([
      NostrFilter(kinds: [30001, 30003, 10003], authors: [pubkey], limit: 20),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchCalendarEvents({int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [31922, 31923], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchGroups({int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [39000, 39001, 39002], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchMarketListings({int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [30402], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  Future<List<NostrEvent>> fetchLiveStreams({int limit = 20}) async {
    return relayPool.query([
      NostrFilter(kinds: [30311], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  /// Fetch a single event by ID.
  Future<NostrEvent?> fetchEventById(String id) async {
    final events = await relayPool.query([
      NostrFilter(ids: [id], limit: 1),
    ], timeout: const Duration(seconds: 8));
    return events.isEmpty ? null : events.first;
  }

  /// Fetch events by IDs (batch).
  Future<List<NostrEvent>> fetchEventsByIds(List<String> ids) async {
    if (ids.isEmpty) return [];
    return relayPool.query([
      NostrFilter(ids: ids, limit: ids.length),
    ], timeout: const Duration(seconds: 8));
  }

  /// Fetch video/reel events (kind 1 with media URLs or kind 21/22 video).
  Future<List<NostrEvent>> fetchVideos({int limit = 50}) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [1, 21, 22], limit: limit * 2),
    ], timeout: const Duration(seconds: 8));
    // Filter to events with video URLs
    final videos = events.where((e) {
      final c = e.content.toLowerCase();
      return c.contains('.mp4') ||
          c.contains('.mov') ||
          c.contains('.webm') ||
          c.contains('youtube.com') ||
          c.contains('youtu.be') ||
          c.contains('vimeo.com');
    }).toList();
    videos.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return videos.take(limit).toList();
  }

  /// Fetch popular hashtags from recent events.
  /// Properly filters by time window and includes engagement weighting.
  Future<List<HashtagStat>> fetchTrendingHashtags({
    int limit = 20,
    int hours = 24,
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final since = now - (hours * 3600);

    final events = await relayPool.query([
      NostrFilter(kinds: [1, 20, 21, 22, 30023], since: since, limit: 500),
    ], timeout: const Duration(seconds: 8));

    if (events.isEmpty) return [];

    // Fetch engagement for all events to weight hashtags
    final eventIds = events.map((e) => e.id).toList();
    final engagementMap = await engagement.fetchEngagementBatch(eventIds);

    final counts = <String, int>{};
    final weighted = <String, double>{};

    for (final e in events) {
      final eng = engagementMap[e.id] ?? const EventEngagement();
      final weight = 1.0 + (eng.score * 0.1); // Boost by engagement

      for (final tag in e.hashtags) {
        final t = tag.toLowerCase();
        counts[t] = (counts[t] ?? 0) + 1;
        weighted[t] = (weighted[t] ?? 0) + weight;
      }
    }

    // Sort by weighted score (engagement-weighted), fall back to count
    final sorted = weighted.entries.toList()
      ..sort((a, b) {
        final countCompare = (counts[b.key] ?? 0).compareTo(counts[a.key] ?? 0);
        if (countCompare != 0) return countCompare;
        return b.value.compareTo(a.value);
      });

    return sorted
        .take(limit)
        .map((e) => HashtagStat(tag: e.key, count: counts[e.key] ?? 0))
        .toList();
  }
}
