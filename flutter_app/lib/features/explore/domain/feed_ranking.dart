import 'dart:math';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/repositories/engagement_repository.dart';

/// Anti-manipulation feed ranking — the "genuine content rises, scripts
/// don't" engine for Discover/Trending.
///
/// Why raw engagement counts fail: a bot cluster of 50 keys can like/repost
/// one post to the top of any "most liked" list. The blueprint this follows
/// (and the wider industry) ranks on signals that are expensive to fake:
///
/// - **Unique engagers, not raw totals.** 50 likes from 50 fresh keys is
///   weaker than 12 likes from 12 established, independent accounts. We rank
///   on `uniqueEngagers` (deduped pubkeys), so a cluster counts once-ish.
/// - **Author diversity.** One author (or one cluster) must not occupy the
///   feed — we cap per-author representation in a window.
/// - **Freshness with decay.** New genuine conversation beats an old
///   inflated post (Hacker-News-style time decay, but on the
///   manipulation-resistant score).
///
/// Safety/moderation is a HARD exclusion applied by the caller before this
/// ranks — popularity never overrides a filter verdict.
class FeedRanking {
  FeedRanking._();

  /// Score a candidate post for Trending, in (0, ∞) — higher is hotter.
  ///
  /// [engagement]  — the post's deduped engagement (uniqueEngagers is key).
  /// [createdAt]   — the post's timestamp (seconds).
  /// [nowSeconds]  — current time (seconds) for freshness decay.
  /// [authorPostCountInWindow] — how many of the window's candidates share
  ///   this author (diversity penalty when one author dominates).
  static double trendingScore({
    required EventEngagement engagement,
    required int createdAt,
    required int nowSeconds,
    int authorPostCountInWindow = 1,
  }) {
    // Genuine engagement: UNIQUE engagers dominate the score; raw counts
    // only nudge it. This is the whole anti-manipulation point — a cluster
    // of fresh keys inflating reactions/reposts can't top a post with broad
    // independent engagement, because raw counts are heavily discounted and
    // capped, while unique engagers (deduped) carry full weight. Zaps cost
    // sats, so they're the one raw signal worth real weight.
    final rawDiscount =
        (engagement.reactions * 0.05 + engagement.reposts * 0.1);
    final cappedRaw = rawDiscount > 3.0 ? 3.0 : rawDiscount; // cap bot upside
    final genuine = (engagement.uniqueEngagers * 1.0) +
        (engagement.replies * 0.5) +
        cappedRaw +
        (engagement.zaps * 1.5);

    // Freshness decay (HN-style): newer is hotter, saturating over ~a day.
    final ageHours = max(0, nowSeconds - createdAt) / 3600.0;
    final freshness = 1.0 / pow(ageHours + 2, 1.5);

    // Diversity: an author flooding the window scores progressively worse.
    // 1 post = 1.0, 3 = 0.66, 5 = 0.5, 10 = 0.33.
    final diversity = 1.0 / (1.0 + 0.5 * (authorPostCountInWindow - 1));

    return (genuine + 1.0) * freshness * diversity;
  }

  /// Score a candidate for the Discover feed (surfacing NEW creators +
  /// genuine conversation, not just already-hot posts).
  static double discoverScore({
    required EventEngagement engagement,
    required int createdAt,
    required int nowSeconds,
    required bool authorFollowed,
    int authorPostCountInWindow = 1,
  }) {
    final genuine = engagement.uniqueEngagers +
        (engagement.replies * 0.6) + // conversation is the strongest signal
        (engagement.reactions * 0.2) +
        (engagement.zaps * 1.2);

    // Discovery bonus: a post from someone the user does NOT follow yet is
    // worth surfacing (that's the point of Discover).
    final discoveryBonus = authorFollowed ? 0.5 : 1.5;

    final ageHours = max(0, nowSeconds - createdAt) / 3600.0;
    final freshness = 1.0 / pow(ageHours + 2, 1.3);
    final diversity = 1.0 / (1.0 + 0.5 * (authorPostCountInWindow - 1));

    return (genuine + 1.0) * discoveryBonus * freshness * diversity;
  }

  /// Count candidates per author in a window (for the diversity penalty).
  static Map<String, int> authorCounts(List<NostrEvent> candidates) {
    final counts = <String, int>{};
    for (final e in candidates) {
      counts[e.pubkey] = (counts[e.pubkey] ?? 0) + 1;
    }
    return counts;
  }

  /// Rank a candidate list by [scoreFn], returning events best-first.
  /// Caps per-author representation so no single author dominates the page.
  static List<NostrEvent> rank(
    List<NostrEvent> candidates, {
    required Map<String, EventEngagement> engagementMap,
    required int nowSeconds,
    required double Function(EventEngagement, NostrEvent, int authorCount)
    scoreFn,
    int limit = 50,
    int maxPerAuthor = 3,
  }) {
    final counts = authorCounts(candidates);
    final scored = candidates.map((e) {
      final eng = engagementMap[e.id] ?? const EventEngagement();
      final s = scoreFn(eng, e, counts[e.pubkey] ?? 1);
      return (event: e, score: s);
    }).toList()
      ..sort((a, b) => b.score.compareTo(a.score));

    // Per-author cap: take best-first but limit how many from one author.
    final result = <NostrEvent>[];
    final taken = <String, int>{};
    for (final s in scored) {
      final author = s.event.pubkey;
      final n = taken[author] ?? 0;
      if (n >= maxPerAuthor) continue;
      taken[author] = n + 1;
      result.add(s.event);
      if (result.length >= limit) break;
    }
    return result;
  }
}
