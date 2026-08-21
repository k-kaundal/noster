import type { NostrEvent } from '@nostrify/nostrify';
import { readContentWarning } from '@/lib/contentWarning';

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

/**
 * Warning categories that mean sex, as opposed to the several that do not.
 *
 * A warning is not an adult-content flag — violence and spoilers use the same
 * tag — so only these two switch this filter on.
 */
const ADULT_CATEGORIES = new Set(['nudity', 'sexual']);

export function classifyNsfw(event: NostrEvent): NsfwVerdict {
  /**
   * The NIP-36 warning first, read properly: a category in an `l` tag is a
   * stated fact about the post, where the reason is prose that has to be
   * pattern-matched. Preferring the stated one means a note labelled
   * `["l", "nudity", "content-warning"]` is caught even when its author wrote
   * no reason at all.
   */
  const warning = readContentWarning(event);
  if (warning) {
    const category = warning.categories.find((id) => ADULT_CATEGORIES.has(id));
    if (category) return { adult: true, reason: category };

    // A bare warning with no reason is not necessarily adult, so it is left
    // alone — a spoiler tag should not be filtered as pornography
    if (warning.reason && ADULT_REASONS.test(warning.reason)) {
      return { adult: true, reason: warning.reason };
    }
  }

  for (const [name, value] of event.tags) {
    if (name === 't' && value && ADULT_TAGS.has(value.toLowerCase())) {
      return { adult: true, reason: `#${value.toLowerCase()}` };
    }

    /**
     * Some clients label the whole event rather than tagging it (NIP-32).
     * Matched without regard to namespace, unlike a content warning, because
     * this is a closed list of words that mean one thing in any vocabulary —
     * and unlike a warning, guessing wrong here only affects someone who
     * turned this filter on.
     */
    if (name === 'l' && value && ADULT_TAGS.has(value.toLowerCase())) {
      return { adult: true, reason: value.toLowerCase() };
    }
  }

  return { adult: false };
}

export function isAdultContent(event: NostrEvent): boolean {
  return classifyNsfw(event).adult;
}

/**
 * Drops self-labelled adult content from a list of events.
 *
 * Generic in the event type, like `filterMuted` beside it, so a caller
 * holding a narrower row type gets that type back and can chain the two
 * without a cast.
 */
export function filterAdultContent<T extends NostrEvent>(
  events: T[],
  allow: boolean
): T[] {
  if (allow) return events;
  return events.filter((event) => !isAdultContent(event));
}
