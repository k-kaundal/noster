import type { NostrEvent } from '@nostrify/nostrify';

/** NIP-88 poll and response kinds. */
export const POLL_KIND = 1068;
export const POLL_RESPONSE_KIND = 1018;

export type PollType = 'singlechoice' | 'multiplechoice';

export interface PollOption {
  id: string;
  label: string;
}

export interface Poll {
  question: string;
  options: PollOption[];
  type: PollType;
  /** Unix seconds after which votes stop counting, if the author set one. */
  endsAt?: number;
  /** Relays the author asked responses to be published to. */
  relays: string[];
}

export interface PollTally {
  counts: Record<string, number>;
  total: number;
  /** Option ids the given voter chose. */
  ownChoices: string[];
}

/** Reads a kind 1068 event into a poll, or null if it is malformed. */
export function parsePoll(event: NostrEvent): Poll | null {
  if (event.kind !== POLL_KIND) return null;

  const options = event.tags
    .filter(([name]) => name === 'option')
    .map(([, id, label]) => ({ id, label: label ?? '' }))
    .filter((option) => !!option.id);

  // A poll with fewer than two choices isn't answerable
  if (options.length < 2) return null;

  const declaredType = event.tags.find(([name]) => name === 'polltype')?.[1];
  const endsAt = event.tags.find(([name]) => name === 'endsAt')?.[1];
  const parsedEndsAt = endsAt ? Number.parseInt(endsAt, 10) : Number.NaN;

  return {
    question: event.content,
    options,
    // The spec defaults to single choice when the tag is absent
    type: declaredType === 'multiplechoice' ? 'multiplechoice' : 'singlechoice',
    endsAt: Number.isFinite(parsedEndsAt) ? parsedEndsAt : undefined,
    relays: event.tags
      .filter(([name]) => name === 'relay')
      .map(([, url]) => url)
      .filter(Boolean),
  };
}

export function isPollClosed(poll: Poll, now = Date.now() / 1000): boolean {
  return poll.endsAt !== undefined && now > poll.endsAt;
}

/**
 * Tallies responses.
 *
 * Voters get one vote each: where someone responded more than once, only their
 * latest response within the poll's lifetime counts. Responses after the
 * closing time are discarded, and unknown option ids are ignored so a crafted
 * response can't invent choices.
 */
export function tallyPoll(
  poll: Poll,
  responses: NostrEvent[],
  viewerPubkey?: string
): PollTally {
  const validIds = new Set(poll.options.map((option) => option.id));

  const latestByVoter = new Map<string, NostrEvent>();
  for (const response of responses) {
    if (response.kind !== POLL_RESPONSE_KIND) continue;
    if (poll.endsAt !== undefined && response.created_at > poll.endsAt) continue;

    const existing = latestByVoter.get(response.pubkey);
    if (!existing || response.created_at > existing.created_at) {
      latestByVoter.set(response.pubkey, response);
    }
  }

  const counts: Record<string, number> = {};
  for (const option of poll.options) counts[option.id] = 0;

  let total = 0;
  let ownChoices: string[] = [];

  for (const [pubkey, response] of latestByVoter) {
    const chosen = response.tags
      .filter(([name]) => name === 'response')
      .map(([, id]) => id)
      .filter((id) => validIds.has(id));

    // Single-choice polls count only the first selection, per the spec
    const effective =
      poll.type === 'singlechoice'
        ? chosen.slice(0, 1)
        : [...new Set(chosen)];

    if (!effective.length) continue;

    for (const id of effective) counts[id] += 1;
    total += 1;

    if (pubkey === viewerPubkey) ownChoices = effective;
  }

  return { counts, total, ownChoices };
}

/** Percentage of voters who chose an option, rounded for display. */
export function optionShare(tally: PollTally, optionId: string): number {
  if (!tally.total) return 0;
  return Math.round(((tally.counts[optionId] ?? 0) / tally.total) * 100);
}

/** Random, URL-safe option ids, matching the style used in the spec examples. */
export function generateOptionId(): string {
  return Math.random().toString(36).slice(2, 11);
}

/** Builds the tags for a new poll event. */
export function buildPollTags(options: {
  choices: string[];
  type: PollType;
  endsAt?: number;
  relays?: string[];
}): string[][] {
  const tags: string[][] = options.choices
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label) => ['option', generateOptionId(), label]);

  tags.push(['polltype', options.type]);
  if (options.endsAt) tags.push(['endsAt', String(Math.floor(options.endsAt))]);
  for (const relay of options.relays ?? []) tags.push(['relay', relay]);

  return tags;
}
