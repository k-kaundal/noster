import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-57 Appendix G: `zap` tags.
 *
 * An event can name who its zaps go to, instead of them going to whoever
 * posted it. A collaboration splits between contributors; a repost of somebody
 * else's work sends the money to them. When these tags are present the
 * author's own `lud16` is not the destination — "clients wishing to zap it
 * SHOULD calculate the lnurl pay request based on the tags value instead of
 * the event author's profile field".
 *
 * Ignoring them does not fail loudly. It quietly pays the wrong person, which
 * is why this is worth getting exactly right rather than approximately.
 */

export interface ZapShare {
  pubkey: string;
  /** Relay carrying their kind 0, so their lightning address can be found. */
  relay?: string;
  /** As written. Absent means no weight was given for this recipient. */
  weight?: number;
}

export interface ResolvedShare extends ZapShare {
  /** Millisats for this recipient. Sums exactly to the total across shares. */
  amountMsat: number;
  /** 0–100, for display. */
  percent: number;
}

/**
 * The `zap` tags on an event.
 *
 * A malformed weight — negative, or not a number — is treated as absent rather
 * than as zero. The two differ: absent can still mean an equal share when no
 * recipient has a weight, whereas zero means "do not pay this person", and
 * turning a typo into that would silently drop somebody from a split.
 */
export function parseZapSplits(event: NostrEvent): ZapShare[] {
  const shares: ZapShare[] = [];
  const seen = new Set<string>();

  for (const [name, pubkey, relay, weight] of event.tags) {
    if (name !== 'zap') continue;
    if (!/^[0-9a-f]{64}$/i.test(pubkey ?? '')) continue;

    const key = pubkey.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const parsed = weight === undefined ? NaN : Number.parseFloat(weight);

    shares.push({
      pubkey: key,
      relay: relay?.trim() || undefined,
      weight: Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined,
    });
  }

  return shares;
}

/**
 * Divides an amount across a split.
 *
 * Two rules from the spec, and they interact:
 *
 *  - "If weights are not present, CLIENTS should equally divide the zap amount
 *    to all receivers."
 *  - "If weights are only partially present, receivers without a weight should
 *    not be zapped (weight = 0)."
 *
 * So a weight missing everywhere means an even split, but a weight missing on
 * only some recipients means those get nothing. Reading either rule alone
 * gives the wrong answer for the other case.
 *
 * Remainders go to the largest shares first, so the parts add up to exactly
 * what was sent. Dropping a millisat per recipient would leave a zap that
 * quietly totals less than the person agreed to.
 */
export function splitAmount(
  shares: ZapShare[],
  totalMsat: number
): ResolvedShare[] {
  if (!shares.length || totalMsat <= 0) return [];

  const anyWeighted = shares.some((share) => share.weight !== undefined);

  const weights = shares.map((share) =>
    anyWeighted ? (share.weight ?? 0) : 1
  );

  const sum = weights.reduce((total, weight) => total + weight, 0);

  /**
   * Every weight zero — either explicitly, or because the only weighted
   * recipients were given 0. Nobody is paid rather than the amount being
   * spread over people the event said to skip.
   */
  if (sum <= 0) return [];

  const exact = weights.map((weight) => (totalMsat * weight) / sum);
  const floored = exact.map((value) => Math.floor(value));

  let remainder = totalMsat - floored.reduce((total, value) => total + value, 0);

  // Largest fractional part first, which is the standard fair rounding
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const entry of order) {
    if (remainder <= 0) break;
    floored[entry.index] += 1;
    remainder -= 1;
  }

  return shares
    .map((share, index) => ({
      ...share,
      amountMsat: floored[index],
      percent: Math.round((floored[index] / totalMsat) * 100),
    }))
    /**
     * A recipient allotted nothing is dropped rather than zapped for zero: an
     * invoice for no amount is not a thing a wallet will produce, and a row
     * saying "0 sats" reads as a failure rather than as the event's own
     * instruction.
     */
    .filter((share) => share.amountMsat > 0);
}

/** Whether an event routes its zaps somewhere other than its author. */
export function hasZapSplit(event: NostrEvent): boolean {
  return parseZapSplits(event).length > 0;
}
