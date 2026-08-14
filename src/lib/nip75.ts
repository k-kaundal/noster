import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-75: fundraising goals, funded by zapping the goal itself.
 *
 * The unusual part is `relays`. A goal names the relays its zap receipts will
 * be published to and tallied from, and a zap that does not name them produces
 * a receipt the goal never sees — money that left somebody's wallet and shows
 * up nowhere on the progress bar. That is why the spec makes it a MUST rather
 * than a hint, and why the tally reads from exactly those relays instead of
 * whichever ones this client happens to be using.
 */

export const GOAL_KIND = 9041;

export interface ZapGoal {
  /** Human-readable description, from `.content`. */
  description: string;
  /** Target, in millisats — the unit the tag is in. */
  amountMsat: number;
  /** Where receipts are published and tallied from. Required by the spec. */
  relays: string[];
  /** Receipts published after this do not count. */
  closedAt?: number;
  image?: string;
  summary?: string;
  /** A URL the goal is about. */
  url?: string;
  /** An addressable event the goal is about. */
  addressPointer?: string;
  /**
   * Everyone the money is meant for, from NIP-57 `zap` tags. The author is not
   * implied — a goal can raise for somebody else entirely.
   */
  beneficiaries: { pubkey: string; relay?: string; weight?: number }[];
  event: NostrEvent;
}

function tagValues(event: NostrEvent, name: string): string[][] {
  return event.tags.filter(([key]) => key === name);
}

function firstValue(event: NostrEvent, name: string): string | undefined {
  const value = tagValues(event, name)[0]?.[1]?.trim();
  return value || undefined;
}

/**
 * The relays named by a goal.
 *
 * `["relays", "wss://a", "wss://b"]` — one tag holding many values, not one
 * tag each. Both shapes turn up, so both are read; only websocket URLs
 * survive, because an https entry here would be passed to a zap request and
 * rejected by the LNURL server that receives it.
 */
export function goalRelays(event: NostrEvent): string[] {
  const urls = tagValues(event, 'relays')
    .flatMap((tag) => tag.slice(1))
    .map((url) => url?.trim())
    .filter(
      (url): url is string =>
        !!url && (url.startsWith('wss://') || url.startsWith('ws://'))
    );

  return [...new Set(urls)];
}

export function parseZapGoal(event: NostrEvent): ZapGoal | null {
  if (event.kind !== GOAL_KIND) return null;

  const amountMsat = Number.parseInt(firstValue(event, 'amount') ?? '', 10);

  /**
   * Both are REQUIRED, and a goal missing either cannot work rather than
   * merely looking incomplete: no amount means no progress to show, and no
   * relays means every zap sent to it lands somewhere the tally will not
   * look.
   */
  if (!Number.isFinite(amountMsat) || amountMsat <= 0) return null;

  const relays = goalRelays(event);
  if (!relays.length) return null;

  const closedAt = Number.parseInt(firstValue(event, 'closed_at') ?? '', 10);

  return {
    description: event.content.trim(),
    amountMsat,
    relays,
    closedAt: Number.isFinite(closedAt) && closedAt > 0 ? closedAt : undefined,
    image: firstValue(event, 'image'),
    summary: firstValue(event, 'summary'),
    url: firstValue(event, 'r'),
    addressPointer: firstValue(event, 'a'),
    beneficiaries: tagValues(event, 'zap')
      .map(([, pubkey, relay, weight]) => ({
        pubkey: pubkey?.trim() ?? '',
        relay: relay?.trim() || undefined,
        weight: weight ? Number.parseFloat(weight) : undefined,
      }))
      .filter((entry) => /^[0-9a-f]{64}$/i.test(entry.pubkey)),
    event,
  };
}

export interface GoalInput {
  description: string;
  amountMsat: number;
  relays: string[];
  closedAt?: number;
  image?: string;
  summary?: string;
  url?: string;
  addressPointer?: string;
}

/**
 * The tags for a kind 9041.
 *
 * Throws when nothing usable is left after filtering, rather than emitting a
 * bare `["relays"]` with no values in it. That published cleanly, parsed as
 * null in every client including this one, and left the author holding a goal
 * that could not be read or funded — a failure with no symptom until somebody
 * tried to zap it.
 */
export function buildGoalTags(input: GoalInput): string[][] {
  const relays = [
    ...new Set(
      input.relays
        .map((url) => url.trim())
        .filter((url) => url.startsWith('wss://') || url.startsWith('ws://'))
    ),
  ];

  if (!relays.length) {
    throw new Error(
      'A goal needs at least one websocket relay to count its zaps at.'
    );
  }

  const tags: string[][] = [
    ['relays', ...relays],
    ['amount', String(Math.round(input.amountMsat))],
  ];

  if (input.closedAt) tags.push(['closed_at', String(Math.floor(input.closedAt))]);
  if (input.image) tags.push(['image', input.image]);
  if (input.summary) tags.push(['summary', input.summary]);
  if (input.url) tags.push(['r', input.url]);
  if (input.addressPointer) tags.push(['a', input.addressPointer]);

  return tags;
}

/**
 * The goal an addressable event points at, via its `goal` tag.
 *
 * `["goal", "<event id>", "<relay hint>"]`. The hint matters here more than
 * usual: a goal names its own tallying relays, and the event linking to it may
 * be the only place saying where to find the goal in the first place.
 */
export function linkedGoal(
  event: NostrEvent
): { id: string; relay?: string } | null {
  const tag = event.tags.find(([name, value]) => name === 'goal' && !!value);
  if (!tag) return null;

  return { id: tag[1].trim(), relay: tag[2]?.trim() || undefined };
}

/** Whether a receipt counts toward a goal that has a deadline. */
export function countsTowardGoal(
  goal: Pick<ZapGoal, 'closedAt'>,
  receiptCreatedAt: number
): boolean {
  return goal.closedAt === undefined || receiptCreatedAt <= goal.closedAt;
}

export interface GoalProgress {
  raisedMsat: number;
  targetMsat: number;
  /** 0–1, capped. A goal can be over-funded; a bar cannot be over-full. */
  fraction: number;
  percent: number;
  isReached: boolean;
  /** True once `closed_at` has passed. */
  isClosed: boolean;
  contributorCount: number;
}

export function goalProgress(
  goal: ZapGoal,
  receipts: { amountMsat: number; senderPubkey?: string; createdAt: number }[],
  now: number = Math.floor(Date.now() / 1000)
): GoalProgress {
  const counted = receipts.filter((receipt) =>
    countsTowardGoal(goal, receipt.createdAt)
  );

  const raisedMsat = counted.reduce(
    (total, receipt) => total + receipt.amountMsat,
    0
  );

  const contributors = new Set(
    counted
      .map((receipt) => receipt.senderPubkey)
      .filter((pubkey): pubkey is string => !!pubkey)
  );

  const fraction =
    goal.amountMsat > 0 ? Math.min(1, raisedMsat / goal.amountMsat) : 0;

  return {
    raisedMsat,
    targetMsat: goal.amountMsat,
    fraction,
    /**
     * Floored, so a goal one sat short of its target does not round up to
     * "100%" while the bar is visibly not full.
     */
    percent: Math.floor(fraction * 100),
    isReached: raisedMsat >= goal.amountMsat,
    isClosed: goal.closedAt !== undefined && goal.closedAt < now,
    contributorCount: contributors.size,
  };
}

/**
 * The relays a zap request must name to fund this goal.
 *
 * The goal's own relays come first and are never dropped by the cap that
 * limits how many a zap request carries. Losing them to the reader's relay
 * list would satisfy the letter of "send a zap" while missing the point of
 * it: the receipt would exist, and the goal would never count it.
 */
export function zapRelaysForGoal(
  goal: ZapGoal,
  ownRelays: string[],
  max: number
): string[] {
  const ordered = [...goal.relays, ...ownRelays];
  return [...new Set(ordered)].slice(0, Math.max(goal.relays.length, max));
}
