import type { NostrEvent } from '@nostrify/nostrify';
import { addressOf } from './eventKinds';

/** NIP-25 reaction. */
export const REACTION_KIND = 7;
/** NIP-09 deletion request. */
export const DELETION_KIND = 5;
/** NIP-56 report. */
export const REPORT_KIND = 1984;

/**
 * A reaction's display form.
 *
 * NIP-25 leaves "+" and the empty string both meaning "like", and "-" meaning
 * dislike. Anything else is the emoji itself, or a `:shortcode:` naming a
 * custom emoji carried in the event's tags (NIP-30).
 */
export function reactionEmoji(event: NostrEvent): string {
  const content = event.content.trim();
  if (!content || content === '+') return '❤️';
  if (content === '-') return '👎';
  return content;
}

/** The image URL for a `:shortcode:` reaction, when the event supplies one. */
export function customEmojiUrl(event: NostrEvent): string | null {
  const match = event.content.trim().match(/^:([\w-]+):$/);
  if (!match) return null;

  const tag = event.tags.find(
    ([name, shortcode]) => name === 'emoji' && shortcode === match[1]
  );
  return tag?.[2] ?? null;
}

export function isLike(event: NostrEvent): boolean {
  const content = event.content.trim();
  return content === '+' || content === '';
}

/**
 * The tags on a NIP-25 reaction.
 *
 * The fourth position of the `e` tag is the **author of the event being
 * reacted to**. This code used to put the literal string `root` there, copied
 * from NIP-10 threading where the fourth field is a marker — so every
 * reaction this app sent claimed to have been written by someone named
 * "root", and any client resolving the target through that hint failed.
 *
 * An addressable target gets an `a` tag alongside the `e`, which is what lets
 * a reaction to an article survive the author editing it: the id changes with
 * every revision, the address does not.
 */
export function buildReactionTags(
  target: NostrEvent,
  options: {
    /** Where the target can be found. A hint, so a guess is better than none. */
    relay?: string;
    emoji?: { shortcode: string; url: string };
  } = {}
): string[][] {
  const hint = options.relay ?? '';
  const tags: string[][] = [];

  const address = addressOf(target);
  if (address) tags.push(['a', address, hint]);

  // The spec asks for the target's id to be the last `e` tag and its author
  // the last `p`; with one of each that is satisfied by writing them at all
  tags.push(['e', target.id, hint, target.pubkey]);
  tags.push(['p', target.pubkey, hint]);
  tags.push(['k', String(target.kind)]);

  if (options.emoji) {
    tags.push(['emoji', options.emoji.shortcode, options.emoji.url]);
  }

  return tags.map((tag) => {
    // Trailing empties carry no information and only pad the event
    const trimmed = [...tag];
    while (trimmed.length > 2 && !trimmed[trimmed.length - 1]) trimmed.pop();
    return trimmed;
  });
}

/**
 * The tags for withdrawing a reaction.
 *
 * NIP-09 asks for the kind of what is being deleted, which lets a relay
 * decide whether it will honour the request without first looking the event
 * up — and lets one that has already dropped it honour it anyway.
 */
export function buildUnreactTags(reactionId: string): string[][] {
  return [
    ['e', reactionId],
    ['k', String(REACTION_KIND)],
  ];
}

export interface ReactionGroup {
  /** What to render — an emoji, or a shortcode when `url` is set. */
  emoji: string;
  /** Custom emoji image, when this group is a NIP-30 shortcode. */
  url: string | null;
  count: number;
  /** Whether the signed-in user is one of the reactors. */
  reacted: boolean;
  /** The user's own reaction, so it can be withdrawn. */
  ownReactionId?: string;
  pubkeys: string[];
}

/**
 * Collapses a note's reactions into one group per distinct emoji, most used
 * first. Grouping is by rendered emoji rather than raw content, so a note
 * liked with "+" and with "❤️" shows a single count instead of two.
 */
export function groupReactions(
  reactions: NostrEvent[],
  selfPubkey?: string
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();

  for (const reaction of reactions) {
    const emoji = reactionEmoji(reaction);
    const url = customEmojiUrl(reaction);

    let group = groups.get(emoji);
    if (!group) {
      group = { emoji, url, count: 0, reacted: false, pubkeys: [] };
      groups.set(emoji, group);
    }

    // The same person reacting twice is one relay serving a duplicate
    if (group.pubkeys.includes(reaction.pubkey)) continue;

    group.count++;
    group.pubkeys.push(reaction.pubkey);

    if (selfPubkey && reaction.pubkey === selfPubkey) {
      group.reacted = true;
      group.ownReactionId = reaction.id;
    }
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Quick-pick reactions offered before the full picker. */
export const QUICK_REACTIONS = ['❤️', '🔥', '😂', '🤙', '👀', '🫂', '⚡'];

/** NIP-56 report categories, with wording a reader can actually choose between. */
export const REPORT_TYPES = [
  {
    value: 'spam',
    label: 'Spam',
    description: 'Unsolicited, repetitive or automated posting.',
  },
  {
    value: 'nudity',
    label: 'Nudity or sexual content',
    description: 'Explicit imagery posted without a content warning.',
  },
  {
    value: 'profanity',
    label: 'Profanity or hateful speech',
    description: 'Slurs, harassment or abuse directed at someone.',
  },
  {
    value: 'illegal',
    label: 'Illegal content',
    description: 'Content that is unlawful where it was published.',
  },
  {
    value: 'impersonation',
    label: 'Impersonation',
    description: 'Pretending to be someone else.',
  },
  {
    value: 'malware',
    label: 'Malware',
    description: 'Links that install or run hostile software.',
  },
  {
    value: 'other',
    label: 'Something else',
    description: "Doesn't fit any of the above.",
  },
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]['value'];

/**
 * Tags for a NIP-56 report.
 *
 * The reported author is always tagged, and the note as well when one is
 * named. A moderator seeing only a `p` tag can act on the account; seeing an
 * `e` tag too tells them which post prompted it.
 */
export function buildReportTags(input: {
  pubkey: string;
  eventId?: string;
  kind?: number;
  type: ReportType;
}): string[][] {
  const tags: string[][] = [['p', input.pubkey, input.type]];

  if (input.eventId) {
    tags.push(['e', input.eventId, input.type]);
    if (typeof input.kind === 'number') {
      tags.push(['k', String(input.kind)]);
    }
  }

  return tags;
}

/**
 * Tags for a NIP-09 deletion request.
 *
 * The `k` tag lets relays apply the request without first fetching the event
 * being deleted, which is the difference between a deletion that propagates
 * and one that quietly does nothing.
 */
export function buildDeletionTags(events: NostrEvent[]): string[][] {
  const kinds = new Set<number>();
  const tags: string[][] = [];

  for (const event of events) {
    tags.push(['e', event.id]);
    kinds.add(event.kind);
  }

  for (const kind of kinds) {
    tags.push(['k', String(kind)]);
  }

  return tags;
}
