
/**
 * What ranks a post on the trending page.
 *
 * Kept out of the hook so it can be tested directly: the hook imports the
 * Nostr provider, which cannot be loaded in this test environment, and a
 * ranking nobody can write assertions against is a ranking that quietly
 * drifts.
 */

export interface EngagementCounts {
  likes?: number;
  replies?: number;
  reposts?: number;
  impressions?: number;
  zaps?: number;
  zapSats?: number;
  ageHours?: number;
}

/**
 * How much a zap is worth against a tap.
 *
 * Sats are the whole difference between this network and the others, and they
 * were worth exactly nothing in this ranking — the score counted likes,
 * replies and reposts and ignored payment entirely. Eight is a judgement, not
 * a measurement: a like is free and reversible, a zap costs money and is not,
 * so a handful of people paying should outrank a crowd tapping.
 */
const ZAP_WEIGHT = 8;

/**
 * Calculate engagement score for trending ranking
 */
export function calculateEngagementScore(counts: EngagementCounts = {}): number {
  const {
    likes = 0,
    replies = 0,
    reposts = 0,
    impressions = 0,
    zaps = 0,
    zapSats = 0,
    ageHours = 1,
  } = counts;

  // Weight recent content more heavily
  const ageWeight = Math.max(0.1, 1 - (ageHours / 168)); // Decay over 1 week

  /**
   * The amount counts, but on a square root.
   *
   * Linearly, one person sending 100,000 sats outranks every other post on
   * the site combined, and "trending" becomes a list of whatever the richest
   * account felt like promoting — for the price of one zap to itself. Rooted,
   * that same 100,000 sats is worth about 316 while a hundred separate
   * thousand-sat zaps are worth 3,160. Breadth beats depth, which is what a
   * trending list is supposed to measure.
   */
  const amount = zapSats > 0 ? Math.sqrt(zapSats) : 0;

  // Engagement weights (reposts valued highest, then likes, then replies)
  const score =
    (likes * 1) +
    (replies * 2) +
    (reposts * 3) +
    (impressions * 0.1) +
    (zaps * ZAP_WEIGHT) +
    amount;

  return Math.round(score * ageWeight * 100) / 100;
}
