/**
 * Money, as integers.
 *
 * Lightning settles in millisatoshis and every amount in this app ultimately
 * becomes one, so millisats are the unit everything is stored and compared in.
 * Satoshis exist for people to read.
 *
 * The rule that matters: **no floating point arithmetic on money.** A price is
 * an integer count of millisats, and it stays one through every multiplication
 * and split. `0.1 + 0.2` is famously not `0.3`, and a fee taken as
 * `amount * 0.1` on a large enough balance is off by an amount somebody
 * eventually notices — in the direction of whoever wrote the code, which is
 * the worst possible direction for it to be off in.
 *
 * Percentages are therefore taken with integer arithmetic and an explicit
 * remainder, so a split always adds back up to what went in.
 */

/** An integer count of millisatoshis. */
export type Msat = number;

export const MSAT_PER_SAT = 1000;

/** Whether a value can be a money amount at all. */
export function isMsat(value: unknown): value is Msat {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Sats to millisats.
 *
 * Throws on a fractional input rather than rounding it. A caller passing 0.5
 * sats has a bug — Lightning has millisat precision and this function is how
 * you reach it, so silently rounding would hide the mistake at the one point
 * it could still be caught.
 */
export function toMsat(sats: number): Msat {
  if (!Number.isFinite(sats) || !Number.isInteger(sats)) {
    throw new RangeError(`Not a whole number of sats: ${sats}`);
  }

  return sats * MSAT_PER_SAT;
}

/**
 * Millisats to whole sats, rounded down.
 *
 * Down, always, because this is what somebody is shown they have. Rounding up
 * shows a balance that cannot be spent and an invoice that cannot be paid.
 */
export function toSats(msat: Msat): number {
  return Math.floor(msat / MSAT_PER_SAT);
}

/** Whether an amount is a whole number of sats, with no millisat remainder. */
export function isWholeSats(msat: Msat): boolean {
  return msat % MSAT_PER_SAT === 0;
}

/**
 * Splits an amount by a percentage, exactly.
 *
 * Returns both halves and guarantees they add back to the original: the
 * remainder from the division goes to the second half rather than being lost
 * to rounding. A platform fee that quietly rounds in the platform's favour on
 * every transaction is a rounding bug on the way in and a scandal on the way
 * out, so the leftover millisat goes to the creator by construction.
 */
export function splitPercent(
  total: Msat,
  percent: number
): { taken: Msat; remainder: Msat } {
  if (!isMsat(total)) throw new RangeError(`Not an amount: ${total}`);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`Not a percentage: ${percent}`);
  }

  // Integer arithmetic throughout: multiply first, then divide, then floor
  const taken = Math.floor((total * percent) / 100);

  return { taken, remainder: total - taken };
}

/**
 * Adds amounts, refusing to produce a number that cannot be trusted.
 *
 * `Number.MAX_SAFE_INTEGER` millisats is about 90,000 BTC, so this will not
 * fire in practice — but a total that silently loses precision is worse than
 * one that throws, because a ledger is the last place an approximate answer
 * belongs.
 */
export function sumMsat(amounts: Msat[]): Msat {
  return amounts.reduce<Msat>((total, amount) => {
    const next = total + amount;
    if (!Number.isSafeInteger(next)) {
      throw new RangeError('Amount too large to represent exactly');
    }
    return next;
  }, 0);
}

/**
 * The full number, grouped — "10,000 sats".
 *
 * Distinct from the compact form used on a post, where `formatSats` in
 * `lib/zap` gives "10k". A price, a balance and an invoice are read to the
 * digit; a zap total on a note is read at a glance.
 */
export function formatSatsFull(msat: Msat): string {
  return `${toSats(msat).toLocaleString()} sats`;
}
