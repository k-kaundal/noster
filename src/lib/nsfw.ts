import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Keeping adult content out of a feed nobody asked to see it in.
 *
 * Removing relays helps and is not enough: a general relay carries whatever
 * its users post, and a note reaches a feed through whichever relay happens to
 * answer first. What the note says about itself travels with it, so that is
 * what this reads.
 *
 * Nothing here is a content classifier. It honours the labels people already
 * attach — NIP-36 warnings and the hashtags the same posts carry — and does
 * not try to guess about anything unlabelled, because a guess that is wrong
 * hides someone's ordinary post with no way for them to know why.
 */

/**
 * Hashtags that mean adult content on Nostr.
 *
 * Deliberately narrow. `t` tags are a free-for-all, and a broad list starts
 * catching photographers, medical accounts and anyone discussing the subject
 * rather than posting it.
 */
const ADULT_TAGS = new Set([
  'nsfw',
  'porn',
  'porno',
  'pornography',
  'xxx',
  'adult',
  'nude',
  'nudes',
  'nudity',
  'sex',
  'onlyfans',
  'hentai',
  'boobs',
  'milf',
  'lewd',
  'rule34',
  'nsfwtwt',
]);

/**
 * Words in a NIP-36 reason that mark the warning as being about sex.
 *
 * A content warning can be about anything — spoilers, violence, politics — and
 * hiding all of them under an adult-content setting would be wrong. Only a
 * warning that says what it is about counts here.
 */
const ADULT_REASONS =
  /\b(nsfw|nude|nudity|naked|porn|sexual|sexually explicit|explicit|adult content|xxx|lewd|hentai)\b/i;

export interface NsfwVerdict {
  /** Whether the note labelled itself as adult content. */
  adult: boolean;
  /** The label it used, for telling someone why something is hidden. */
  reason?: string;
}

export function classifyNsfw(event: NostrEvent): NsfwVerdict {
  for (const [name, value] of event.tags) {
    if (name === 'content-warning') {
      // A bare warning with no reason is not necessarily adult, so it is left
      // alone — a spoiler tag should not be filtered as pornography
      if (value && ADULT_REASONS.test(value)) {
        return { adult: true, reason: value };
      }
      continue;
    }

    if (name === 't' && value && ADULT_TAGS.has(value.toLowerCase())) {
      return { adult: true, reason: `#${value.toLowerCase()}` };
    }

    // Some clients label the whole event rather than tagging it (NIP-32)
    if (name === 'l' && value && ADULT_TAGS.has(value.toLowerCase())) {
      return { adult: true, reason: value.toLowerCase() };
    }
  }

  return { adult: false };
}

export function isAdultContent(event: NostrEvent): boolean {
  return classifyNsfw(event).adult;
}

/** Drops self-labelled adult content from a list of events. */
export function filterAdultContent(
  events: NostrEvent[],
  allow: boolean
): NostrEvent[] {
  if (allow) return events;
  return events.filter((event) => !isAdultContent(event));
}
