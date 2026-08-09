import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Spam detection result with confidence score and reasons
 */
export interface SpamDetectionResult {
  isSpam: boolean;
  confidence: number; // 0-100
  reasons: string[]; // Array of detected spam signals
}

/**
 * Analyze posting frequency for spam patterns
 * Flag users posting >10 events in 5 minutes
 */
export function analyzePostingFrequency(
  events: NostrEvent[],
  authorPubkey: string,
  timeWindowMinutes = 5
): boolean {
  const now = Date.now() / 1000;
  const cutoff = now - timeWindowMinutes * 60;

  const authorEvents = events.filter(
    (e) => e.pubkey === authorPubkey && e.created_at > cutoff
  );

  return authorEvents.length > 10;
}

/**
 * Detect content repetition - same or very similar posts in a row
 * Flag if >50% of content is repeated
 */
export function analyzeContentRepetition(
  events: NostrEvent[],
  authorPubkey: string
): boolean {
  const authorEvents = events
    .filter((e) => e.pubkey === authorPubkey)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 20); // Check last 20 posts

  if (authorEvents.length < 3) return false;

  const contents = authorEvents.map((e) => e.content.toLowerCase().trim());

  // Count unique contents
  const uniqueContents = new Set(contents).size;
  const repetitionRate = 1 - uniqueContents / contents.length;

  // Flag if >50% of content is repeated
  return repetitionRate > 0.5;
}

/**
 * Detect hashtag stuffing - >50% of content is hashtags
 * Signals low-quality content trying to game discovery
 */
export function analyzeHashtagStuffing(event: NostrEvent): boolean {
  const content = event.content.trim();
  if (content.length === 0) return false;

  const words = content.split(/\s+/);
  const hashtagCount = words.filter((w) => w.startsWith('#')).length;
  const hashtagRatio = hashtagCount / words.length;

  // Flag if >50% are hashtags
  return hashtagRatio > 0.5;
}

/**
 * Detect mention spam - excessive mentions suggesting mass targeting
 * Flag if >25% of content is @mentions
 */
export function analyzeMentionSpam(event: NostrEvent): boolean {
  const content = event.content.trim();
  if (content.length === 0) return false;

  const words = content.split(/\s+/);
  const mentionCount = words.filter((w) => w.startsWith('@') || w.startsWith('npub')).length;
  const mentionRatio = mentionCount / words.length;

  // Flag if >25% are mentions
  return mentionRatio > 0.25;
}

/**
 * Detect URL spam - many URLs suggesting promotional content
 * Flag if >3 URLs in a single post
 */
export function analyzeUrlSpam(event: NostrEvent): boolean {
  const urlPattern = /https?:\/\/[^\s]+/g;
  const urls = event.content.match(urlPattern) || [];
  return urls.length > 3;
}

/**
 * Check if event has suspicious metadata patterns
 * Flag empty metadata, generic names, or bot-like patterns
 */
export function checkMetadataQuality(
  metadata?: { name?: string; about?: string; bot?: boolean }
): boolean {
  if (!metadata) return true; // No metadata = suspicious

  // Explicitly marked as bot is okay
  if (metadata.bot === true) return false;

  // Empty name or suspicious default patterns
  const name = metadata.name || '';
  const botPatterns = ['bot', 'account', 'user', 'username', 'noname'];
  const isSuspiciousName = name.length === 0 ||
    botPatterns.some((p) => name.toLowerCase().includes(p));

  // Empty or minimal about section
  const aboutLength = (metadata.about || '').length;
  const isSuspiciousAbout = aboutLength < 10;

  return isSuspiciousName || isSuspiciousAbout;
}

/**
 * Comprehensive spam detection combining multiple signals
 */
export function detectSpam(
  event: NostrEvent,
  allEvents: NostrEvent[],
  metadata?: { name?: string; about?: string; bot?: boolean }
): SpamDetectionResult {
  const reasons: string[] = [];
  let confidence = 0;

  // Check hashtag stuffing (20 points)
  if (analyzeHashtagStuffing(event)) {
    reasons.push('Excessive hashtags detected');
    confidence += 20;
  }

  // Check mention spam (15 points)
  if (analyzeMentionSpam(event)) {
    reasons.push('Excessive mentions detected');
    confidence += 15;
  }

  // Check URL spam (25 points)
  if (analyzeUrlSpam(event)) {
    reasons.push('Multiple URLs in single post');
    confidence += 25;
  }

  // Check posting frequency (25 points)
  if (analyzePostingFrequency(allEvents, event.pubkey)) {
    reasons.push('Excessive posting frequency');
    confidence += 25;
  }

  // Check content repetition (20 points)
  if (analyzeContentRepetition(allEvents, event.pubkey)) {
    reasons.push('Repeated content from same author');
    confidence += 20;
  }

  // Check metadata quality (10 points)
  if (checkMetadataQuality(metadata)) {
    reasons.push('Suspicious account metadata');
    confidence += 10;
  }

  // Cap confidence at 100
  confidence = Math.min(confidence, 100);

  // Flag as spam if confidence > 40%
  const isSpam = confidence > 40;

  return {
    isSpam,
    confidence,
    reasons,
  };
}
