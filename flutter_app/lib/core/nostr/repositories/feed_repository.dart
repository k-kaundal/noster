import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';
import 'package:nostrfeed_mobile/core/nostr/repositories/engagement_repository.dart';
import 'package:nostrfeed_mobile/features/explore/domain/feed_ranking.dart';

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
    // Include: text notes, reposts, generic reposts, pictures, videos,
    // articles, polls (NIP-88 kind 1068 renders via PollCard).
    const kinds = [1, 6, 16, 20, 21, 22, 30023, 1068];

    // Relays cap filter list size (strfry maxReqFilterSize = 200) — a
    // 500-follow Following feed in ONE filter is REJECTED, which surfaced
    // as "no posts / could not fetch" on exactly the accounts with large
    // follow lists (and fresh installs whose follows just resolved). Chunk
    // the author list so the query is always servable, then merge.
    if (authors != null && authors.length > _authorChunkSize) {
      final merged = <String, NostrEvent>{};
      for (var i = 0; i < authors.length; i += _authorChunkSize) {
        final end = i + _authorChunkSize > authors.length
            ? authors.length
            : i + _authorChunkSize;
        final chunk = authors.sublist(i, end);
        final events = await relayPool.query([
          NostrFilter(
            kinds: kinds,
            limit: limit,
            since: since,
            until: until,
            authors: chunk,
          ),
        ], timeout: const Duration(seconds: 8));
        for (final e in events) {
          merged[e.id] = e;
        }
      }
      final out = merged.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      return out.length > limit ? out.sublist(0, limit) : out;
    }

    final filter = NostrFilter(
      kinds: kinds,
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

  /// Authors per feed query — under every relay's filter list cap
  /// (strfry maxReqFilterSize = 200). Profile prefetch uses 40 (smaller
  /// payload); the feed can afford 150 (bigger pages, fewer round-trips).
  static const _authorChunkSize = 150;

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
    // 1 = mention/reply, 3 = new follower (contact list), 4 = NIP-04 DM,
    // 6 = repost, 7 = reaction, 16 = generic repost, 9735 = zap receipt,
    // 1111 = NIP-22 comment, 1059 = NIP-17 DM, 30023 = article mention,
    // 31925 = calendar RSVP
    final events = await relayPool.query([
      NostrFilter(
        kinds: [1, 3, 4, 6, 7, 16, 9735, 1111, 1059, 30023, 31925],
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

  Future<List<NostrEvent>> fetchDMs(String pubkey, {int limit = 200}) async {
    return relayPool.query([
      // Kind 4 (NIP-04 legacy): sent by us
      NostrFilter(kinds: [4], authors: [pubkey], limit: limit),
      // Kind 4: sent TO us
      NostrFilter(
        kinds: [4],
        tagFilters: {'p': [pubkey]},
        limit: limit,
      ),
      // Kind 1059 (NIP-17 gift wrap): sent TO us (including our own copy
      // which is also p-tagged to us per NIP-17).
      // NOTE: We can't query by author for NIP-17 — the author is a random
      // ephemeral key, not the real sender.
      NostrFilter(
        kinds: [1059],
        tagFilters: {'p': [pubkey]},
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

    // Fetch candidate posts from the time window. limit*5→*3 (250→150) and
    // 10s→6s: ranking saturates well before 250 candidates, and the long
    // timeout was the slowest leg of the whole explore screen.
    final candidates = await relayPool.query([
      NostrFilter(
        kinds: [1, 20, 21, 22, 30023],
        since: since,
        limit: limit * 3, // Fetch extra to filter by engagement
      ),
    ], timeout: const Duration(seconds: 6));

    if (candidates.isEmpty) return [];

    // Fetch engagement for all candidates in one batched query
    final eventIds = candidates.map((e) => e.id).toList();
    final engagementMap = await engagement.fetchEngagementBatch(eventIds);

    // Rank with the anti-manipulation engine: unique engagers (not raw
    // counts), freshness decay, per-author diversity cap. A bot cluster
    // inflating raw likes can't top this — genuine conversation rises.
    final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    return FeedRanking.rank(
      candidates,
      engagementMap: engagementMap,
      nowSeconds: nowSeconds,
      scoreFn: (eng, event, authorCount) => FeedRanking.trendingScore(
        engagement: eng,
        createdAt: event.createdAt,
        nowSeconds: nowSeconds,
        authorPostCountInWindow: authorCount,
      ),
      limit: limit,
    );
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

  /// NIP-29 group chat messages: kind 9 chat messages (and kind 11 threads)
  /// tagged with the group's `h` id.
  Future<List<NostrEvent>> fetchGroupChat(
    String groupId, {
    int limit = 100,
    int? until,
  }) async {
    final events = await relayPool.query([
      NostrFilter(
        kinds: [9, 11, 1],
        tagFilters: {
          'h': [groupId],
        },
        limit: limit,
        until: until,
      ),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  /// Live subscription for new NIP-29 group chat messages.
  Stream<NostrEvent> subscribeGroupChat(String groupId, {int? since}) {
    return relayPool.subscribe([
      NostrFilter(
        kinds: [9, 11, 1],
        tagFilters: {
          'h': [groupId],
        },
        since: since ?? DateTime.now().millisecondsSinceEpoch ~/ 1000 - 60,
      ),
    ]);
  }

  Future<List<NostrEvent>> fetchMarketListings({int limit = 50}) async {
    return relayPool.query([
      NostrFilter(kinds: [30402], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  /// Fetch P2P trade orders (NIP-69 kind 38383), pending first.
  Future<List<NostrEvent>> fetchP2POrders({int limit = 50}) async {
    final events = await relayPool.query([
      NostrFilter(kinds: [38383], limit: limit),
    ], timeout: const Duration(seconds: 8));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  Future<List<NostrEvent>> fetchLiveStreams({int limit = 20}) async {
    return relayPool.query([
      NostrFilter(kinds: [30311], limit: limit),
    ], timeout: const Duration(seconds: 8));
  }

  /// Live chat messages (kind 1311) for one live activity coordinate.
  Future<List<NostrEvent>> fetchLiveChat(
    String coordinate, {
    int limit = 100,
    int? until,
  }) async {
    final events = await relayPool.query([
      NostrFilter(
        kinds: [1311],
        tagFilters: {
          'a': [coordinate],
        },
        limit: limit,
        until: until,
      ),
    ], timeout: const Duration(seconds: 6));
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return events;
  }

  /// Live subscription for new live chat messages on one activity.
  Stream<NostrEvent> subscribeLiveChat(String coordinate) {
    return relayPool.subscribe([
      NostrFilter(
        kinds: [1311],
        tagFilters: {
          'a': [coordinate],
        },
        since: DateTime.now().millisecondsSinceEpoch ~/ 1000 - 60,
      ),
    ]);
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
  /// Fetch video events for the reels feed.
  ///
  /// NIP-71: kind 22 = short-form portrait video (reels/shorts), kind 21 =
  /// normal (landscape) video. The playable source + poster live in `imeta`
  /// tags (NIP-92). Kind-1 notes with video URLs are included as a fallback
  /// since many clients still post videos that way.
  Future<List<NostrEvent>> fetchVideos({int limit = 50}) async {
    // Query dedicated video events first (kind 22 reels are the priority).
    final videoEvents = await relayPool.query([
      NostrFilter(kinds: [22, 21], limit: limit),
    ], timeout: const Duration(seconds: 8));

    // Fallback: kind-1 notes carrying a video URL.
    final noteEvents = await relayPool.query([
      NostrFilter(kinds: [1], limit: limit),
    ], timeout: const Duration(seconds: 6));

    final videos = <NostrEvent>[];
    final seen = <String>{};

    // Dedicated video events first — they're the canonical NIP-71 format.
    for (final e in videoEvents) {
      if (seen.add(e.id) && _hasVideoSource(e)) videos.add(e);
    }
    // Then kind-1 notes with a video URL (lower priority, deduped).
    for (final e in noteEvents) {
      if (seen.add(e.id) && _hasVideoSource(e)) videos.add(e);
    }

    videos.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return videos.take(limit).toList();
  }

  /// True when an event has a playable video source: an imeta video tag
  /// (NIP-71) or a video URL in the content.
  bool _hasVideoSource(NostrEvent e) {
    // imeta video tag (NIP-71 canonical source).
    for (final tag in e.tags) {
      if (tag.isEmpty || tag[0] != 'imeta') continue;
      final hasUrl = tag.any((p) => p.startsWith('url '));
      final isVideo = tag.any((p) => p.startsWith('m video/'));
      if (hasUrl && isVideo) return true;
    }
    // Video URL in content (kind-1 fallback).
    final c = e.content.toLowerCase();
    return c.contains('.mp4') ||
        c.contains('.mov') ||
        c.contains('.webm') ||
        c.contains('.m4v') ||
        c.contains('youtube.com') ||
        c.contains('youtu.be') ||
        c.contains('vimeo.com');
  }

  /// Fetch popular hashtags from recent events.
  /// Properly filters by time window and includes engagement weighting.
  Future<List<HashtagStat>> fetchTrendingHashtags({
    int limit = 20,
    int hours = 24,
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final since = now - (hours * 3600);

    // 500→250 events: tag-counting saturates well before 500, and halving
    // the payload halves the slowest relay leg (the explore waterfall).
    final events = await relayPool.query([
      NostrFilter(kinds: [1, 20, 21, 22, 30023], since: since, limit: 250),
    ], timeout: const Duration(seconds: 6));

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
