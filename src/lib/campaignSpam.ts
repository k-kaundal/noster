/**
 * The spam one account cannot commit.
 *
 * `lib/spam.ts` asks whether a *person* is behaving badly: posting too often,
 * repeating themselves, stuffing hashtags. Every one of those signals looks at
 * a single pubkey, and the attack that actually arrives looks like this:
 *
 *     Cool Raven replied to you      — "I built a sovereign, zero-KYC…"
 *     Calm Cheetah replied to you    — "I built a sovereign, zero-KYC…"
 *     Quiet Otter replied to you     — "I built a sovereign, zero-KYC…"
 *
 * One post each, seconds apart, from accounts with no profile. Nobody repeats
 * themselves, nobody posts too often, nobody stuffs anything — every per-author
 * check passes, and the inbox is full of the same advert.
 *
 * Keys are free on Nostr, so counting per key measures the wrong thing. What
 * cannot be faked cheaply is *coincidence*: the same words arriving from
 * several accounts at once is either a campaign or a quote, and quotes do not
 * land in one person's replies within the same minute.
 *
 * So this module fingerprints content and looks across authors. It is
 * deliberately separate from `spam.ts` because it answers a different
 * question, needs a corpus rather than an event, and must never be used to
 * decide anything about one account on its own.
 */
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * The shape of a message, ignoring what a bot varies between sends.
 *
 * URLs come out because swapping a tracking parameter is the cheapest possible
 * mutation. Punctuation, case and whitespace go for the same reason. What is
 * left is the sentence somebody wrote, which is the expensive part to vary and
 * therefore the part worth matching on.
 */
export function contentFingerprint(content: string): string {
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/nostr:[a-z0-9]+/g, ' ')
    // Emoji and punctuation, which cost nothing to shuffle
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Below this there is not enough text for a match to mean anything. */
export const MIN_FINGERPRINT_LENGTH = 24;

/** How far apart two sends can be and still count as one campaign. */
export const CAMPAIGN_WINDOW_SECONDS = 6 * 3600;

export interface Campaign {
  fingerprint: string;
  /** Distinct authors sending it. Two is already a coincidence worth noting. */
  authors: Set<string>;
  events: NostrEvent[];
  firstAt: number;
  lastAt: number;
}

/**
 * Identical messages arriving from more than one account.
 *
 * Grouped on the fingerprint, then filtered to groups where the authors
 * differ: one person saying the same thing twice is a person with a habit,
 * and several people saying it word for word is a script.
 */
export function findCampaigns(
  events: NostrEvent[],
  options: { windowSeconds?: number; minAuthors?: number } = {}
): Campaign[] {
  const windowSeconds = options.windowSeconds ?? CAMPAIGN_WINDOW_SECONDS;
  const minAuthors = options.minAuthors ?? 2;

  const groups = new Map<string, Campaign>();

  for (const event of events) {
    const fingerprint = contentFingerprint(event.content);
    if (fingerprint.length < MIN_FINGERPRINT_LENGTH) continue;

    const existing = groups.get(fingerprint);

    if (!existing) {
      groups.set(fingerprint, {
        fingerprint,
        authors: new Set([event.pubkey]),
        events: [event],
        firstAt: event.created_at,
        lastAt: event.created_at,
      });
      continue;
    }

    existing.authors.add(event.pubkey);
    existing.events.push(event);
    existing.firstAt = Math.min(existing.firstAt, event.created_at);
    existing.lastAt = Math.max(existing.lastAt, event.created_at);
  }

  return [...groups.values()].filter(
    (campaign) =>
      campaign.authors.size >= minAuthors &&
      campaign.lastAt - campaign.firstAt <= windowSeconds
  );
}

export interface TrustContext {
  /** Who the reader follows. Anything from these is never filtered. */
  following: Set<string>;
  /**
   * Who their follows follow. A weaker signal than a direct follow and a much
   * stronger one than nothing — this is the difference between a stranger and
   * somebody a friend vouched for.
   */
  extended?: Set<string>;
  /** The reader themselves, who is never spam to themselves. */
  self?: string;
}

export type SpamReason =
  /** The same message, from several accounts. */
  | 'campaign'
  /** A stranger with no profile at all, carrying a link. */
  | 'anonymous-link';

export interface SpamVerdict {
  event: NostrEvent;
  reasons: SpamReason[];
}

/**
 * Whether a profile is empty enough to have been made by a script.
 *
 * Not a signal on its own — plenty of real people never fill one in, and
 * treating an empty profile as guilt would silence every newcomer. It only
 * counts alongside something else.
 */
export function isBlankProfile(
  metadata: { name?: string; display_name?: string; picture?: string; about?: string } | undefined
): boolean {
  if (!metadata) return true;

  return (
    !metadata.name?.trim() &&
    !metadata.display_name?.trim() &&
    !metadata.picture?.trim() &&
    !metadata.about?.trim()
  );
}

const LINK = /https?:\/\/\S+/i;

/**
 * Which of these should be held back, and why.
 *
 * Two rules, and both are deliberately narrow. Anything from somebody the
 * reader follows is never filtered — a false positive there costs a real
 * message from a real friend, which is worse than any amount of spam. Anything
 * from a friend-of-a-friend is exempt from the profile rule but not from the
 * campaign rule, because a bought account can be followed by another bought
 * account.
 *
 * Nothing is deleted. The caller shows the count and lets the reader look.
 */
export function judgeSpam(
  events: NostrEvent[],
  context: TrustContext,
  profiles: Map<string, { name?: string; display_name?: string; picture?: string; about?: string } | undefined> = new Map(),
  options: { windowSeconds?: number; minAuthors?: number } = {}
): SpamVerdict[] {
  const campaigns = findCampaigns(events, options);

  const campaigned = new Set<string>();
  for (const campaign of campaigns) {
    for (const event of campaign.events) campaigned.add(event.id);
  }

  const verdicts: SpamVerdict[] = [];

  for (const event of events) {
    // Never the reader's own words, and never somebody they chose to follow
    if (event.pubkey === context.self) continue;
    if (context.following.has(event.pubkey)) continue;

    const reasons: SpamReason[] = [];

    if (campaigned.has(event.id)) reasons.push('campaign');

    const vouched = context.extended?.has(event.pubkey) ?? false;

    /*
     * Only when the profile was actually looked up and found empty. An author
     * whose kind 0 has not arrived yet is unknown, not blank — treating the
     * two the same would filter every stranger with a link for as long as the
     * profile query is in flight, which is most of the time on a cold start.
     */
    if (
      !vouched &&
      profiles.has(event.pubkey) &&
      isBlankProfile(profiles.get(event.pubkey)) &&
      LINK.test(event.content)
    ) {
      reasons.push('anonymous-link');
    }

    if (reasons.length) verdicts.push({ event, reasons });
  }

  return verdicts;
}

/** What to tell the reader, when they ask what was held back. */
export function describeSpamReason(reason: SpamReason): string {
  switch (reason) {
    case 'campaign':
      return 'The same message was sent by several accounts';
    default:
      return 'A new account with no profile, posting a link';
  }
}

/**
 * Splits a list into what to show and what to hold back.
 *
 * The held-back half is returned rather than dropped. A filter somebody cannot
 * inspect is indistinguishable from a bug, and the one message this gets wrong
 * is the one the reader most needs to find.
 */
export function partitionSpam<T>(
  items: T[],
  eventOf: (item: T) => NostrEvent,
  context: TrustContext,
  profiles?: Map<string, { name?: string; display_name?: string; picture?: string; about?: string } | undefined>,
  options?: { windowSeconds?: number; minAuthors?: number }
): { kept: T[]; filtered: T[]; reasons: Map<string, SpamReason[]> } {
  const verdicts = judgeSpam(items.map(eventOf), context, profiles, options);

  const byEvent = new Map(
    verdicts.map((verdict) => [verdict.event.id, verdict.reasons])
  );

  const kept: T[] = [];
  const filtered: T[] = [];
  const reasons = new Map<string, SpamReason[]>();

  for (const item of items) {
    const found = byEvent.get(eventOf(item).id);

    if (found) {
      filtered.push(item);
      reasons.set(eventOf(item).id, found);
    } else {
      kept.push(item);
    }
  }

  return { kept, filtered, reasons };
}
