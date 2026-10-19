import 'dart:convert';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';

/// Engagement stats for an event.
class EventEngagement {
  final int replies;
  final int reactions;
  final int reposts;
  final int zaps;
  final int zapSats;
  const EventEngagement({
    this.replies = 0,
    this.reactions = 0,
    this.reposts = 0,
    this.zaps = 0,
    this.zapSats = 0,
  });
  int get score => replies + reactions + reposts + zaps;
}

class EngagementRepository {
  final RelayPool relayPool;
  EngagementRepository(this.relayPool);

  /// Fetch engagement (replies + reactions + reposts + zaps) for an event.
  Future<EventEngagement> fetchEngagement(String eventId) async {
    final events = await relayPool.query([
      NostrFilter(
        kinds: [1, 6, 7, 16, 9735, 1111],
        tagFilters: {
          'e': [eventId],
        },
        limit: 500,
      ),
    ], timeout: const Duration(seconds: 6));
    return _computeEngagement(events);
  }

  /// Engagement for an addressable event (30000-39999). Looks up by 'a' tag.
  Future<EventEngagement> fetchEngagementForAddress(String coordinate) async {
    final events = await relayPool.query([
      NostrFilter(
        kinds: [1, 6, 7, 16, 9735, 1111],
        tagFilters: {
          'a': [coordinate],
          'A': [coordinate],
        },
        limit: 500,
      ),
    ], timeout: const Duration(seconds: 6));
    return _computeEngagement(events);
  }

  /// Fetch engagement for multiple events in a single batched query.
  /// Returns a map of eventId → engagement stats.
  Future<Map<String, EventEngagement>> fetchEngagementBatch(
    List<String> eventIds,
  ) async {
    if (eventIds.isEmpty) return {};

    // Query all engagement events that reference any of the target events
    final events = await relayPool.query([
      NostrFilter(
        kinds: [1, 6, 7, 16, 9735],
        tagFilters: {'e': eventIds},
        limit: 1000,
      ),
    ], timeout: const Duration(seconds: 8));

    // Group by the event they reference
    final Map<String, List<NostrEvent>> byTarget = {};
    for (final e in events) {
      for (final tag in e.tags) {
        if (tag.isNotEmpty && tag[0] == 'e' && tag.length > 1) {
          final targetId = tag[1];
          if (eventIds.contains(targetId)) {
            byTarget.putIfAbsent(targetId, () => []).add(e);
            break; // Only count once per event
          }
        }
      }
    }

    // Compute engagement for each target
    final result = <String, EventEngagement>{};
    for (final id in eventIds) {
      result[id] = _computeEngagement(byTarget[id] ?? []);
    }
    return result;
  }

  /// Check if the current user has liked or reposted specific events.
  /// Returns maps of eventId → true/false for likes and reposts.
  Future<({Map<String, bool> likes, Map<String, bool> reposts})>
  fetchUserInteractions(List<String> eventIds, String userPubkey) async {
    if (eventIds.isEmpty || userPubkey.isEmpty) {
      return (
        likes: const <String, bool>{},
        reposts: const <String, bool>{},
      );
    }

    final events = await relayPool.query([
      NostrFilter(
        kinds: [6, 7, 16],
        authors: [userPubkey],
        tagFilters: {'e': eventIds},
        limit: 500,
      ),
    ], timeout: const Duration(seconds: 6));

    final likes = <String, bool>{};
    final reposts = <String, bool>{};

    for (final e in events) {
      for (final tag in e.tags) {
        if (tag.isNotEmpty && tag[0] == 'e' && tag.length > 1) {
          final targetId = tag[1];
          if (eventIds.contains(targetId)) {
            if (e.kind == 7) {
              likes[targetId] = true;
            } else if (e.kind == 6 || e.kind == 16) {
              reposts[targetId] = true;
            }
            break;
          }
        }
      }
    }

    return (likes: likes, reposts: reposts);
  }

  Future<List<NostrEvent>> fetchZapReceipts(
    String targetId, {
    bool isEvent = true,
  }) async {
    return relayPool.query([
      NostrFilter(
        kinds: [9735],
        tagFilters: isEvent
            ? {
                'e': [targetId],
              }
            : {
                'p': [targetId],
              },
        limit: 100,
      ),
    ], timeout: const Duration(seconds: 8));
  }

  /// Compute engagement stats from a list of related events.
  EventEngagement _computeEngagement(List<NostrEvent> events) {
    int replies = 0, reactions = 0, reposts = 0, zaps = 0, zapSats = 0;
    for (final e in events) {
      switch (e.kind) {
        case 1:
        case 1111: // NIP-22 comments count as replies
          replies++;
          break;
        case 6:
        case 16:
          reposts++;
          break;
        case 7:
          reactions++;
          break;
        case 9735:
          zaps++;
          final sats = _parseZapAmount(e);
          zapSats += sats;
          break;
      }
    }
    return EventEngagement(
      replies: replies,
      reactions: reactions,
      reposts: reposts,
      zaps: zaps,
      zapSats: zapSats,
    );
  }

  int _parseZapAmount(NostrEvent receipt) {
    // Try to parse amount from description (zap request JSON)
    final desc = receipt.getTag('description');
    if (desc != null) {
      try {
        final json = jsonDecode(desc) as Map<String, dynamic>;
        final tags = (json['tags'] as List?)?.cast<List>() ?? [];
        for (final t in tags) {
          if (t.length >= 2 && t[0] == 'amount') {
            return (int.tryParse(t[1].toString()) ?? 0) ~/ 1000;
          }
        }
      } catch (_) {}
    }
    // Fallback to amount tag
    final amount = receipt.getTag('amount');
    if (amount != null) return (int.tryParse(amount) ?? 0) ~/ 1000;
    return 0;
  }
}
