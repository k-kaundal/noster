/**
 * Paid promotion, as public evidence rather than as a private database row.
 *
 * There is no server here, which for advertising is usually a blocker and in
 * this case is a design constraint worth keeping even if there were one. A
 * boost has to be something a reader can check for themselves, or "promoted"
 * means nothing except that we say so.
 *
 * So a boost **is a zap to the platform's own lightning address**, whose zap
 * request names the note being promoted. That gives the whole thing away for
 * free:
 *
 * - The receipt is signed by the platform's lnurl provider (NIP-57), so it
 *   cannot be forged by the person who benefits from it.
 * - The invoice inside it says what was actually paid.
 * - The zap request inside it is signed by the payer, so who bought it is
 *   public.
 * - It is an ordinary event on ordinary relays, so anybody — including a
 *   client that refuses to honour boosts at all — can list everything this
 *   platform has ever promoted and who paid for it.
 *
 * Nothing here is enforceable beyond this client, and that is stated rather
 * than glossed: a boosted note is boosted for readers of NostrFeed. Every
 * other Nostr client sees an ordinary note and a zap receipt, which is exactly
 * what it is.
 */
import type { NostrEvent } from '@nostrify/nostrify';
import { toMsat, type Msat } from '@/lib/money';
import {
  ZAP_RECEIPT_KIND,
  parseZapReceipt,
  validateZapReceipt,
} from '@/lib/zap';

export interface BoostTier {
  /** Stable identifier, for pricing config and analytics. */
  code: 'starter' | 'growth' | 'pro' | 'campaign';
  label: string;
  price: Msat;
  durationSeconds: number;
  /**
   * How far a boost lifts a note in the ranking.
   *
   * Capped deliberately, and low. Money buys distribution here, not control:
   * past about three times, a boosted note stops competing with organic
   * content and starts replacing it, at which point the feed is an ad break
   * that occasionally shows a friend.
   */
  multiplier: number;
}

const HOUR = 3600;
const DAY = 24 * HOUR;

/**
 * What can be bought, cheapest first.
 *
 * Prices are integers in millisats, never floats, and the same numbers the
 * invoice will ask for.
 */
export const BOOST_TIERS: BoostTier[] = [
  {
    code: 'starter',
    label: 'Starter',
    price: toMsat(1_000),
    durationSeconds: DAY,
    multiplier: 1.5,
  },
  {
    code: 'growth',
    label: 'Growth',
    price: toMsat(5_000),
    durationSeconds: DAY,
    multiplier: 2,
  },
  {
    code: 'pro',
    label: 'Pro',
    price: toMsat(10_000),
    durationSeconds: 2 * DAY,
    multiplier: 3,
  },
  {
    code: 'campaign',
    label: 'Campaign',
    price: toMsat(50_000),
    durationSeconds: 7 * DAY,
    multiplier: 3,
  },
];

/** The cheapest thing on the menu — below this, nothing is bought. */
export const MIN_BOOST_MSAT = BOOST_TIERS[0].price;

/** The strongest lift any amount can buy, however much is paid. */
export const MAX_MULTIPLIER = Math.max(
  ...BOOST_TIERS.map((tier) => tier.multiplier)
);

/**
 * What a given payment buys.
 *
 * The largest tier the amount covers, so overpaying is never punished and
 * underpaying by a millisat does not silently buy the tier above. Paying more
 * than the top tier buys the top tier — the cap is the point, and somebody who
 * sends a million sats gets a longer look at the same ceiling everybody else
 * has.
 */
export function tierForAmount(msat: Msat): BoostTier | null {
  let found: BoostTier | null = null;

  for (const tier of BOOST_TIERS) {
    if (msat >= tier.price) found = tier;
  }

  return found;
}

export interface Boost {
  /** The receipt this was read from, so a boost can be pointed at. */
  receiptId: string;
  /** The note being promoted. */
  noteId: string;
  /** Who paid, which is public and shown. */
  payerPubkey: string;
  amount: Msat;
  tier: BoostTier;
  startedAt: number;
  expiresAt: number;
}

export interface BoostSource {
  /**
   * The platform key the payment must have been addressed to.
   *
   * Without this any zap receipt anywhere becomes a boost, and promotion
   * becomes free for anybody who ever zapped anyone.
   */
  platformPubkey: string;
  /**
   * The `nostrPubkey` from the platform's own lnurl provider — the key that
   * signs its zap receipts. This is the check that makes a boost unforgeable,
   * so a boost without it is not honoured at all.
   */
  providerPubkey: string;
}

/**
 * Reads a zap receipt as a boost, or refuses to.
 *
 * Every refusal here is somebody getting promotion they did not pay for, so
 * the checks are deliberately unforgiving. `validateZapReceipt` does the
 * NIP-57 half — provider signature, a payer-signed request, an invoice whose
 * amount matches what the request claimed — and this adds what makes it a
 * boost rather than an ordinary zap.
 */
export function readBoost(
  receipt: NostrEvent,
  source: BoostSource
): Boost | null {
  if (receipt.kind !== ZAP_RECEIPT_KIND) return null;

  /*
   * Read from the zap request inside the receipt rather than from the
   * receipt's own tags. The request is signed by the payer, so it is the half
   * that says what was bought; the outer tags are the lightning server's
   * copy and are not what the signature covers.
   */
  const parsed = parseZapReceipt(receipt);

  const noteId = parsed.targetEventId;
  if (!noteId) return null;

  /*
   * Paid to us, signed by our lightning server, and about this note. The
   * provider check is the one that cannot be worked around: a receipt signed
   * by any other key is somebody's own claim about their own note.
   */
  const valid = validateZapReceipt(receipt, {
    recipientPubkey: source.platformPubkey,
    providerPubkey: source.providerPubkey,
    eventId: noteId,
  });
  if (!valid) return null;

  const payerPubkey = parsed.senderPubkey;
  if (!payerPubkey) return null;

  /*
   * The invoice is what was payable; the request's `amount` tag is only what
   * was asked for. Pricing a boost from the request would let somebody claim
   * a campaign tier on a starter invoice — `parseZapReceipt` reads the
   * invoice first for exactly this reason.
   */
  if (parsed.amountSats === null) return null;

  const amount = toMsat(parsed.amountSats);
  const tier = tierForAmount(amount);
  if (!tier) return null;

  /*
   * Timed from the receipt, which is the platform's own signature and the
   * one timestamp in this that the buyer cannot choose. Using the zap
   * request's `created_at` would let somebody backdate — or postdate — the
   * window they paid for.
   */
  const startedAt = receipt.created_at;

  return {
    receiptId: receipt.id,
    noteId,
    payerPubkey,
    amount,
    tier,
    startedAt,
    expiresAt: startedAt + tier.durationSeconds,
  };
}

/** Whether a boost is still running. Seconds, like every Nostr timestamp. */
export function isActive(boost: Boost, now = Date.now() / 1000): boolean {
  return boost.startedAt <= now && boost.expiresAt > now;
}

/**
 * The boosts in force, one per note, strongest first.
 *
 * A note can be boosted more than once — by its author and a reader, or twice
 * by the same person. They do not add up: the strongest one applies and the
 * rest are still visible in the ledger as what they are. Stacking multipliers
 * would let somebody buy their way past the cap by buying twice, which is the
 * cap not existing.
 */
export function activeBoosts(
  boosts: Boost[],
  now = Date.now() / 1000
): Boost[] {
  const strongest = new Map<string, Boost>();

  for (const boost of boosts) {
    if (!isActive(boost, now)) continue;

    const current = strongest.get(boost.noteId);
    const better =
      !current ||
      boost.tier.multiplier > current.tier.multiplier ||
      (boost.tier.multiplier === current.tier.multiplier &&
        boost.expiresAt > current.expiresAt);

    if (better) strongest.set(boost.noteId, boost);
  }

  return [...strongest.values()].sort(
    (a, b) => b.tier.multiplier - a.tier.multiplier || b.startedAt - a.startedAt
  );
}

/** Most of a feed that may be promoted, however much is paid for. */
export const MAX_PROMOTED_SHARE = 0.1;

/** Organic notes between one promoted note and the next. */
export const PROMOTED_SPACING = 8;

export interface Promotable {
  id: string;
}

export interface PlacedFeed<T extends Promotable> {
  items: T[];
  /** Which of them are promoted, so the UI can label them. */
  promoted: Set<string>;
}

/**
 * Puts promoted notes into a timeline, sparingly.
 *
 * Two limits, and both are hard. No more than one note in nine is promoted,
 * and no more than a tenth of the feed however many were bought — so a day
 * when everybody boosts at once produces the same feed as a quiet one, with
 * the notes that missed out simply not shown rather than queued into a wall
 * of adverts.
 *
 * Promoted notes are moved rather than duplicated: a boosted note already in
 * the timeline is lifted to its slot, not shown twice. Seeing the same note in
 * two places is how a reader learns to distrust a feed.
 */
export function placeBoosted<T extends Promotable>(
  organic: T[],
  boosted: T[],
  options: { maxShare?: number; spacing?: number } = {}
): PlacedFeed<T> {
  const maxShare = options.maxShare ?? MAX_PROMOTED_SHARE;
  const spacing = options.spacing ?? PROMOTED_SPACING;

  const promotedIds = new Set(boosted.map((item) => item.id));

  // A boosted note already in the timeline is lifted, not repeated
  const rest = organic.filter((item) => !promotedIds.has(item.id));

  /*
   * The share is of the feed that results, not of the one that went in.
   * Counting against the organic list alone lets each promoted note enlarge
   * the denominator that is supposed to be limiting it, so ten adverts in a
   * feed of ninety passes a "ten percent" check while being eleven percent of
   * what the reader actually scrolls through.
   */
  const allowed = Math.min(
    boosted.length,
    Math.floor((rest.length * maxShare) / (1 - maxShare)),
    Math.ceil(rest.length / spacing)
  );

  if (allowed <= 0) {
    return { items: rest, promoted: new Set() };
  }

  const taking = boosted.slice(0, allowed);
  const shown = new Set(taking.map((item) => item.id));

  const items: T[] = [];
  let next = 0;

  rest.forEach((item, index) => {
    items.push(item);

    // After every `spacing` organic notes, one promoted note
    if ((index + 1) % spacing === 0 && next < taking.length) {
      items.push(taking[next]);
      next += 1;
    }
  });

  // Anything that did not reach a slot is dropped rather than appended: the
  // bottom of a feed is not a placement, and pretending it is sells nothing
  return { items, promoted: shown };
}
