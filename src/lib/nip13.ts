import { getEventHash } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-13 proof of work.
 *
 * Difficulty is the count of leading zero *bits* in the event id — not zero
 * characters. `002f…` is `0000 0000 0010 1111…`, which is ten, and the spec
 * says so explicitly because counting hex digits instead is the obvious wrong
 * implementation and lands within a factor of four of the right answer, which
 * is close enough to look correct in testing.
 *
 * The other rule worth reading twice is the committed target. A note's actual
 * difficulty is not the whole story: a spammer mining a million notes at 20
 * bits will produce some that happen to reach 30 by luck. The `nonce` tag's
 * third entry is what the miner *intended*, and a note that only got there by
 * accident is one the spec lets you reject on those grounds alone.
 */

/** The `nonce` tag: `["nonce", "<nonce>", "<target difficulty>"]`. */
export const NONCE_TAG = 'nonce';

/**
 * Leading zero bits in a hex string.
 *
 * The spec's own JavaScript, kept close to it deliberately — this is the one
 * function every client has to agree on exactly, and a clever rewrite that
 * differs by a bit makes this app reject notes everybody else accepts.
 */
export function countLeadingZeroes(hex: string): number {
  let count = 0;

  for (let index = 0; index < hex.length; index += 1) {
    const nibble = Number.parseInt(hex[index], 16);

    if (Number.isNaN(nibble)) break;

    if (nibble === 0) {
      count += 4;
      continue;
    }

    count += Math.clz32(nibble) - 28;
    break;
  }

  return count;
}

/** The difficulty an event actually achieved. */
export function eventDifficulty(event: Pick<NostrEvent, 'id'>): number {
  return countLeadingZeroes(event.id);
}

/**
 * The difficulty the miner committed to, when they committed to one.
 *
 * Null and zero are different answers. Null means no commitment was made —
 * which the spec lets a client reject outright — while zero is a commitment to
 * nothing, and fails any positive requirement on its own terms.
 */
export function committedDifficulty(
  event: Pick<NostrEvent, 'tags'>
): number | null {
  const tag = event.tags.find(([name]) => name === NONCE_TAG);
  if (!tag) return null;

  const target = Number.parseInt(tag[2] ?? '', 10);
  return Number.isFinite(target) && target >= 0 ? target : null;
}

export interface PowCheck {
  /** Leading zero bits actually in the id. */
  difficulty: number;
  /** What the miner said they were aiming for, if anything. */
  committed: number | null;
  /** Whether it satisfies the requirement. */
  ok: boolean;
  /** Why not, when it does not. */
  reason?: 'too-low' | 'target-too-low' | 'no-commitment';
}

/**
 * Whether an event's proof of work satisfies a requirement.
 *
 * Three ways to fail, and the middle one is the whole point of the NIP:
 *
 *  - the id simply does not have enough leading zeroes;
 *  - it does, but the miner committed to a lower target, which means they were
 *    mining cheaply in bulk and this one got lucky. "If you require 40 bits to
 *    reply to your thread and see a committed target of 30, you can safely
 *    reject it even if the note has 40 bits difficulty";
 *  - there is no commitment at all, which clients MAY reject. Off by default,
 *    since plenty of honest events predate the convention, but available where
 *    the cost of a lucky spammer is higher than the cost of a false reject.
 */
export function checkPow(
  event: Pick<NostrEvent, 'id' | 'tags'>,
  required: number,
  options: { requireCommitment?: boolean } = {}
): PowCheck {
  const difficulty = eventDifficulty(event);
  const committed = committedDifficulty(event);

  if (required <= 0) return { difficulty, committed, ok: true };

  if (difficulty < required) {
    return { difficulty, committed, ok: false, reason: 'too-low' };
  }

  if (committed === null) {
    return options.requireCommitment
      ? { difficulty, committed, ok: false, reason: 'no-commitment' }
      : { difficulty, committed, ok: true };
  }

  if (committed < required) {
    return { difficulty, committed, ok: false, reason: 'target-too-low' };
  }

  return { difficulty, committed, ok: true };
}

/** An event as it exists before it has an id or a signature. */
export interface MinableEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey: string;
}

export interface MineResult {
  event: MinableEvent;
  /** The id the mined event hashes to. */
  id: string;
  difficulty: number;
  /** How many nonces were tried. */
  attempts: number;
  /** Milliseconds spent. */
  elapsedMs: number;
}

/**
 * How many hashes to try between yields.
 *
 * Mining is a busy loop, and a busy loop on the main thread is a frozen page.
 * Yielding every few thousand attempts keeps the tab responsive — including
 * responsive to the cancel button, which is the control that matters when
 * somebody has asked for a difficulty their laptop cannot reach.
 */
const CHUNK = 5000;

/**
 * Mines an event to a target difficulty.
 *
 * The nonce tag is replaced rather than appended on each attempt, and
 * `created_at` is refreshed as the spec recommends — which also means two
 * runs of this never produce the same id, so a retry is not wasted work
 * repeating a search that already failed.
 *
 * Nothing here signs. The id does not commit to the signature, which is what
 * makes delegated mining possible at all, and it also means the order has to
 * be mine-then-sign: signing first and mining after would invalidate the
 * signature on every attempt.
 */
export async function mineEvent(
  draft: MinableEvent,
  target: number,
  options: { signal?: AbortSignal; onProgress?: (attempts: number) => void } = {}
): Promise<MineResult> {
  const started = Date.now();

  if (target <= 0) {
    const event = { ...draft };
    return {
      event,
      id: getEventHash(event),
      difficulty: countLeadingZeroes(getEventHash(event)),
      attempts: 0,
      elapsedMs: 0,
    };
  }

  /** Everything except the nonce, which is rewritten every attempt. */
  const baseTags = draft.tags.filter(([name]) => name !== NONCE_TAG);

  let nonce = 0;
  let attempts = 0;

  for (;;) {
    const createdAt = Math.floor(Date.now() / 1000);

    for (let index = 0; index < CHUNK; index += 1) {
      nonce += 1;
      attempts += 1;

      const candidate: MinableEvent = {
        ...draft,
        created_at: createdAt,
        tags: [...baseTags, [NONCE_TAG, String(nonce), String(target)]],
      };

      const id = getEventHash(candidate);

      if (countLeadingZeroes(id) >= target) {
        return {
          event: candidate,
          id,
          difficulty: countLeadingZeroes(id),
          attempts,
          elapsedMs: Date.now() - started,
        };
      }
    }

    options.onProgress?.(attempts);

    /**
     * Checked after a chunk rather than before, so a cancel that arrives
     * mid-chunk is still honoured within a few milliseconds instead of after
     * the whole search.
     */
    if (options.signal?.aborted) {
      throw new DOMException('Mining cancelled', 'AbortError');
    }

    // Yields to the event loop; without this the page stops painting
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Roughly how many hashes a difficulty needs.
 *
 * `2^difficulty` on average, which is worth showing to somebody about to ask
 * for 32 bits on a phone: the difference between 20 and 30 is not "a bit
 * longer", it is a thousand times longer.
 */
export function expectedAttempts(difficulty: number): number {
  return 2 ** difficulty;
}

/** A rough human estimate, given a measured hash rate. */
export function estimateSeconds(
  difficulty: number,
  hashesPerSecond: number
): number {
  if (hashesPerSecond <= 0) return Infinity;
  return expectedAttempts(difficulty) / hashesPerSecond;
}
