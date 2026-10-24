import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/repositories/engagement_repository.dart';
import 'package:nostrfeed_mobile/features/explore/domain/feed_ranking.dart';

NostrEvent ev(String pk, int createdAt) => NostrEvent(
      id: '$pk$createdAt'.padRight(16, '0').substring(0, 16),
      pubkey: pk,
      createdAt: createdAt,
      kind: 1,
      tags: const [],
      content: 'post',
      sig: 's',
    );

void main() {
  final now = 1700000000;

  group('anti-manipulation: unique engagers beat raw counts', () {
    test('a post with many UNIQUE engagers outranks a bot-inflated one', () {
      // Genuine post: 12 unique engagers, modest raw counts.
      const genuine = EventEngagement(
        replies: 4,
        reactions: 8,
        reposts: 2,
        uniqueEngagers: 12,
      );
      // Bot-inflated post: huge raw counts but ~2 unique (cluster) engagers.
      const botted = EventEngagement(
        replies: 0,
        reactions: 200,
        reposts: 50,
        uniqueEngagers: 2,
      );
      final gScore = FeedRanking.trendingScore(
        engagement: genuine,
        createdAt: now - 3600,
        nowSeconds: now,
      );
      final bScore = FeedRanking.trendingScore(
        engagement: botted,
        createdAt: now - 3600,
        nowSeconds: now,
      );
      expect(gScore, greaterThan(bScore));
    });

    test('zaps are a strong genuine signal (they cost sats)', () {
      const zapped = EventEngagement(replies: 1, zaps: 5, uniqueEngagers: 6);
      const plain = EventEngagement(replies: 1, uniqueEngagers: 6);
      expect(
        FeedRanking.trendingScore(
          engagement: zapped,
          createdAt: now,
          nowSeconds: now,
        ),
        greaterThan(
          FeedRanking.trendingScore(
            engagement: plain,
            createdAt: now,
            nowSeconds: now,
          ),
        ),
      );
    });

    test('an author flooding the window is diversity-penalized', () {
      const eng = EventEngagement(reactions: 5, uniqueEngagers: 5);
      final solo = FeedRanking.trendingScore(
        engagement: eng,
        createdAt: now,
        nowSeconds: now,
        authorPostCountInWindow: 1,
      );
      final flooding = FeedRanking.trendingScore(
        engagement: eng,
        createdAt: now,
        nowSeconds: now,
        authorPostCountInWindow: 10,
      );
      expect(flooding, lessThan(solo));
    });

    test('fresh posts beat stale ones at equal engagement', () {
      const eng = EventEngagement(reactions: 10, uniqueEngagers: 10);
      final fresh = FeedRanking.trendingScore(
        engagement: eng,
        createdAt: now - 600,
        nowSeconds: now,
      );
      final stale = FeedRanking.trendingScore(
        engagement: eng,
        createdAt: now - 48 * 3600,
        nowSeconds: now,
      );
      expect(fresh, greaterThan(stale));
    });
  });

  group('discoverScore surfaces new creators', () {
    test('an unfollowed author gets a discovery bonus over a followed one', () {
      const eng = EventEngagement(replies: 3, uniqueEngagers: 5);
      final newCreator = FeedRanking.discoverScore(
        engagement: eng,
        createdAt: now,
        nowSeconds: now,
        authorFollowed: false,
      );
      final followed = FeedRanking.discoverScore(
        engagement: eng,
        createdAt: now,
        nowSeconds: now,
        authorFollowed: true,
      );
      expect(newCreator, greaterThan(followed));
    });
  });

  group('rank caps per-author representation', () {
    test('no author occupies more than maxPerAuthor slots', () {
      final candidates = [
        for (var i = 0; i < 10; i++) ev('dominant', now - i * 60),
        for (var i = 0; i < 3; i++) ev('other$i', now - i * 60),
      ];
      final engagementMap = <String, EventEngagement>{
        for (final e in candidates)
          e.id: const EventEngagement(uniqueEngagers: 10, reactions: 10),
      };
      final ranked = FeedRanking.rank(
        candidates,
        engagementMap: engagementMap,
        nowSeconds: now,
        scoreFn: (eng, e, authorCount) => FeedRanking.trendingScore(
          engagement: eng,
          createdAt: e.createdAt,
          nowSeconds: now,
          authorPostCountInWindow: authorCount,
        ),
        limit: 13,
        maxPerAuthor: 3,
      );
      final dominantCount =
          ranked.where((e) => e.pubkey == 'dominant').length;
      expect(dominantCount, lessThanOrEqualTo(3));
    });
  });
}
