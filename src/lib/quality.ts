import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Quality score breakdown - provides detailed scoring metrics
 */
export interface QualityScore {
  total: number; // 0-100
  engagement: number; // Replies, reposts, reactions
  verification: number; // NIP-05, follower count, age
  recency: number; // How fresh the post is
  contentQuality: number; // Length, formatting
}

/**
 * Calculate engagement score based on post statistics
 * Replies, reposts, and reactions indicate quality
 */
export function calculateEngagementScore(event: NostrEvent): number {
  // Extract engagement metrics from tags
  const replies = parseInt(event.tags.find(([name]) => name === 'replies')?.[1] ?? '0');
  const reposts = parseInt(event.tags.find(([name]) => name === 'reposts')?.[1] ?? '0');
  const reactions = parseInt(event.tags.find(([name]) => name === 'reactions')?.[1] ?? '0');

  // Normalize: 1 reply = 1 point, 1 repost = 2 points, 1 reaction = 0.5 points
  const engagement = replies + reposts * 2 + reactions * 0.5;

  // Cap at 100 (logarithmic scale for high engagement)
  if (engagement > 50) {
    return 100;
  }
  return Math.min(engagement * 2, 100);
}

/**
 * Calculate verification score based on author profile quality
 * NIP-05 verification, follower metrics, account age
 */
export function calculateVerificationScore(
  event: NostrEvent,
  authorMetadata?: { nip05?: string; followers?: number; created_at?: number }
): number {
  let score = 20; // Base score for having an event

  // NIP-05 verification adds 30 points
  if (authorMetadata?.nip05) {
    score += 30;
  }

  // Follower count scoring (scaled logarithmically)
  const followers = authorMetadata?.followers ?? 0;
  if (followers > 0) {
    const followerScore = Math.min(Math.log10(followers + 1) * 15, 30);
    score += followerScore;
  }

  // Account age scoring (older accounts more trustworthy)
  if (authorMetadata?.created_at) {
    const ageInDays = (Date.now() / 1000 - authorMetadata.created_at) / 86400;
    if (ageInDays > 365) {
      score += 20; // 1+ year old
    } else if (ageInDays > 30) {
      score += 10; // 1+ month old
    } else if (ageInDays > 7) {
      score += 5; // 1+ week old
    }
  }

  return Math.min(score, 100);
}

/**
 * Calculate recency score - newer posts score higher
 * But don't completely tank older posts
 */
export function calculateRecencyScore(event: NostrEvent): number {
  const ageInHours = (Date.now() / 1000 - event.created_at) / 3600;

  // Linear decay: 100 at 0 hours, 60 at 24 hours, 20 at 7 days
  if (ageInHours < 1) return 100;
  if (ageInHours < 24) return 100 - (ageInHours / 24) * 40;
  if (ageInHours < 168) {
    // 7 days in hours
    return 60 - ((ageInHours - 24) / 144) * 40;
  }
  return 20;
}

/**
 * Calculate content quality score based on text length and formatting
 * Encourages substantive posts while not penalizing short ones
 */
export function calculateContentQualityScore(event: NostrEvent): number {
  const content = event.content.trim();
  const length = content.length;

  // Minimum viable content
  if (length === 0) return 0;
  if (length < 10) return 20; // Too short

  // Optimal range: 50-280 characters (roughly a paragraph)
  if (length >= 50 && length <= 280) return 100;

  // Longer posts also good (thoughtful content)
  if (length > 280 && length <= 1000) return 90;
  if (length > 1000) return 85; // Very long posts might be overwhelming

  // Short but meaningful (10-50 chars)
  return 60;
}

/**
 * Calculate overall quality score for a post
 * Weights engagement (40%), verification (30%), recency (20%), content (10%)
 */
export function calculateQualityScore(
  event: NostrEvent,
  authorMetadata?: { nip05?: string; followers?: number; created_at?: number }
): QualityScore {
  const engagement = calculateEngagementScore(event);
  const verification = calculateVerificationScore(event, authorMetadata);
  const recency = calculateRecencyScore(event);
  const contentQuality = calculateContentQualityScore(event);

  // Weighted average
  const total = Math.round(
    engagement * 0.4 + verification * 0.3 + recency * 0.2 + contentQuality * 0.1
  );

  return {
    total,
    engagement,
    verification,
    recency,
    contentQuality,
  };
}
