/**
 * Recurring support, without anything that can recur.
 *
 * The honest constraints first, because they decide the whole design:
 *
 * - **There is no merged NIP for this.** NIP-88 is Polls. The subscription
 *   draft everybody quotes — tiers as kind 37001 — is an unmerged pull
 *   request, implemented by zap.stream and very little else. The kind is used
 *   here for whatever interoperability that buys, and `NIP.md` says plainly
 *   that it is a draft rather than a standard.
 * - **A client cannot bill anybody.** A browser tab that is closed pays
 *   nothing, and NIP-47 has no scheduling primitive — a wallet budget is a
 *   cap, not a standing order. Any client claiming automatic renewal is
 *   describing "we charge you when you next open the app".
 *
 * So this does not pretend to charge anyone. A subscription here is a *zap to
 * a tier*, and the receipt is the subscription: signed by the creator's
 * lightning server, naming the tier, for an amount anyone can read. That has
 * three properties a subscription table does not.
 *
 * Nothing extra is published. The draft has subscribers announce themselves
 * with a kind 7001 and cancel with a deletion — a declaration of intent that
 * proves no payment and a cancellation that does not stop one. Paying is the
 * only act that means anything, and stopping paying is the only cancellation
 * that works.
 *
 * Anyone can verify. The status below is computed from public receipts, so a
 * creator gating content, a subscriber checking their own standing, and a
 * third party auditing either of them all reach the same answer without
 * asking us.
 *
 * It cannot be forged. `summarizeZaps` already refuses a receipt the
 * recipient's own server did not sign.
 */
import type { NostrEvent } from '@nostrify/nostrify';
import { summarizeZaps, type Zapper } from '@/lib/zapSummary';

/** The unmerged draft's kind for a tier. See `NIP.md`. */
export const TIER_KIND = 37001;

export type Cadence = 'weekly' | 'monthly' | 'yearly';

const CADENCE_SECONDS: Record<Cadence, number> = {
  weekly: 7 * 86_400,
  monthly: 30 * 86_400,
  yearly: 365 * 86_400,
};

export function cadenceSeconds(cadence: Cadence): number {
  return CADENCE_SECONDS[cadence];
}

export function describeCadence(cadence: Cadence): string {
  switch (cadence) {
    case 'weekly':
      return 'week';
    case 'yearly':
      return 'year';
    default:
      return 'month';
  }
}

function readCadence(value: string | undefined): Cadence {
  if (value === 'weekly' || value === 'yearly') return value;
  return 'monthly';
}

export interface Tier {
  /** The `d` tag, which with the creator addresses the tier. */
  slug: string;
  title: string;
  description: string;
  image?: string;
  /** Satoshis per period. Whole sats: this becomes an invoice. */
  amount: number;
  cadence: Cadence;
  perks: string[];
  creator: string;
  createdAt: number;
  event: NostrEvent;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([key]) => key === name)?.[1] || undefined;
}

/**
 * Reads a tier, or refuses.
 *
 * An amount is required and must be a positive whole number of sats, because
 * this number becomes an invoice: a tier priced at nothing, or at half a sat,
 * is a subscribe button that cannot be pressed.
 */
export function parseTier(event: NostrEvent): Tier | null {
  if (event.kind !== TIER_KIND) return null;

  const slug = tagValue(event, 'd');
  if (!slug) return null;

  const amountTag = event.tags.find(([name]) => name === 'amount');
  const amount = Number(amountTag?.[1]);
  if (!Number.isInteger(amount) || amount <= 0) return null;

  return {
    slug,
    title: tagValue(event, 'title') || 'Supporter',
    description: tagValue(event, 'description') || event.content.trim(),
    image: tagValue(event, 'image'),
    amount,
    // The draft carries the period as the amount tag's second value
    cadence: readCadence(amountTag?.[2]),
    perks: event.tags
      .filter(([name]) => name === 'perks')
      .flatMap(([, ...values]) => values)
      .filter(Boolean),
    creator: event.pubkey,
    createdAt: event.created_at,
    event,
  };
}

/** The `kind:pubkey:d` coordinate a subscription zap points at. */
export function tierAddress(tier: Pick<Tier, 'creator' | 'slug'>): string {
  return `${TIER_KIND}:${tier.creator}:${tier.slug}`;
}

export interface TierDraft {
  slug: string;
  title: string;
  description: string;
  image?: string;
  amount: number;
  cadence: Cadence;
  perks: string[];
}

export function buildTierTags(draft: TierDraft): string[][] {
  const tags: string[][] = [
    ['d', draft.slug],
    ['title', draft.title],
    ['amount', String(Math.round(draft.amount)), draft.cadence],
  ];

  if (draft.description) tags.push(['description', draft.description]);
  if (draft.image) tags.push(['image', draft.image]);

  const perks = draft.perks.map((perk) => perk.trim()).filter(Boolean);
  if (perks.length) tags.push(['perks', ...perks]);

  /*
   * NIP-31: a client that does not know this kind shows the alt text rather
   * than an empty box. Worth more than usual here, since the kind is a draft
   * that most clients have never heard of.
   */
  tags.push([
    'alt',
    `Subscription tier: ${draft.title} — ${draft.amount} sats per ${describeCadence(draft.cadence)}`,
  ]);

  return tags;
}

export type SubscriptionState =
  /** Paid, and inside the period that payment bought. */
  | 'active'
  /** Paid before, but the period has run out. */
  | 'lapsed'
  /** Never paid for this tier. */
  | 'none';

export interface SubscriptionStatus {
  state: SubscriptionState;
  /** The payment the state was decided from. */
  lastPayment: Zapper | null;
  /** When the current period ends, or when the last one did. */
  expiresAt: number | null;
  /** Whole days left, or null when there is no period running. */
  daysLeft: number | null;
  /** Everything they have paid on this tier, newest first. */
  history: Zapper[];
  /** Total ever paid on it, which is what a creator wants to see. */
  totalSats: number;
  /**
   * What is still owed, when money arrived but not enough of it.
   *
   * Zero in every other state. This exists because an underpayment used to be
   * indistinguishable from never having paid: the sats left the wallet, the
   * card said "Subscribe", and nothing anywhere said why. Somebody in that
   * position cannot fix it without being told what happened.
   */
  shortfallSats: number;
}

export const NO_SUBSCRIPTION: SubscriptionStatus = {
  state: 'none',
  lastPayment: null,
  expiresAt: null,
  daysLeft: null,
  history: [],
  totalSats: 0,
  shortfallSats: 0,
};

/**
 * Somebody's standing on a tier, read from what they have paid.
 *
 * Payments below the tier price are ignored for the purpose of the period.
 * That is a judgement worth stating: somebody who sends 500 sats towards a
 * 5,000 sat tier has tipped, generously, and has not bought a month — and
 * quietly granting them one would make the price a suggestion. They still
 * appear in the history, because their money was real.
 */
export function subscriptionStatus(
  receipts: NostrEvent[],
  input: {
    tier: Pick<Tier, 'creator' | 'slug' | 'amount' | 'cadence'>;
    subscriber: string;
    now?: number;
  }
): SubscriptionStatus {
  const now = input.now ?? Date.now() / 1000;

  const summary = summarizeZaps(receipts, {
    address: tierAddress(input.tier),
    recipientPubkey: input.tier.creator,
  });

  const mine = summary.zappers
    .filter((zapper) => zapper.pubkey === input.subscriber)
    .sort((a, b) => b.at - a.at);

  if (!mine.length) return NO_SUBSCRIPTION;

  const totalSats = mine.reduce((sum, zapper) => sum + zapper.sats, 0);

  /*
   * The most recent payment that actually covered the price. An older full
   * payment still holds a period open even if a small tip came after it,
   * which is why this is not simply `mine[0]`.
   */
  const qualifying = mine.find((zapper) => zapper.sats >= input.tier.amount);

  if (!qualifying) {
    /*
     * The largest single payment, not the sum. A period is bought by one
     * payment covering the price — three separate tips do not add up to a
     * subscription, because each is measured against the tier on its own.
     */
    const largest = Math.max(...mine.map((zapper) => zapper.sats));

    return {
      state: 'none',
      lastPayment: mine[0],
      expiresAt: null,
      daysLeft: null,
      history: mine,
      totalSats,
      shortfallSats: Math.max(input.tier.amount - largest, 0),
    };
  }

  const expiresAt = qualifying.at + cadenceSeconds(input.tier.cadence);
  const active = expiresAt > now;

  return {
    state: active ? 'active' : 'lapsed',
    lastPayment: qualifying,
    expiresAt,
    daysLeft: active ? Math.ceil((expiresAt - now) / 86_400) : 0,
    history: mine,
    totalSats,
    shortfallSats: 0,
  };
}

/** Whether a period is close enough to its end to be worth mentioning. */
export const RENEWAL_WINDOW_DAYS = 5;

export function needsRenewal(
  status: SubscriptionStatus
): boolean {
  if (status.state === 'lapsed') return true;

  return (
    status.state === 'active' &&
    status.daysLeft !== null &&
    status.daysLeft <= RENEWAL_WINDOW_DAYS
  );
}

/** What to tell somebody about where they stand. */
export function describeStatus(
  status: SubscriptionStatus,
  cadence: Cadence
): string {
  switch (status.state) {
    case 'active':
      return status.daysLeft !== null && status.daysLeft <= RENEWAL_WINDOW_DAYS
        ? `Renews in ${status.daysLeft} ${status.daysLeft === 1 ? 'day' : 'days'}`
        : `Active · ${status.daysLeft} days left`;
    case 'lapsed':
      return `Lapsed — pay again for another ${describeCadence(cadence)}`;
    default:
      /*
       * Said plainly, because this is the state somebody is stuck in without
       * knowing it. They paid, the money is gone, and the card was offering
       * them the same button as somebody who had never paid at all.
       */
      return status.shortfallSats > 0
        ? `${status.shortfallSats.toLocaleString()} sats short of a ${describeCadence(cadence)}`
        : `${describeCadence(cadence) === 'month' ? 'Monthly' : 'Recurring'} support`;
  }
}

/**
 * Every tier a creator offers, cheapest first.
 *
 * Replaceable by address, so a tier edited twice appears twice in a relay
 * response and only the newest revision counts. Deduplicated on the slug
 * rather than the event id for exactly that reason.
 */
export function rankTiers(events: NostrEvent[]): Tier[] {
  const newest = new Map<string, Tier>();

  for (const event of events) {
    const tier = parseTier(event);
    if (!tier) continue;

    const existing = newest.get(tier.slug);
    if (!existing || tier.createdAt > existing.createdAt) {
      newest.set(tier.slug, tier);
    }
  }

  return [...newest.values()].sort((a, b) => a.amount - b.amount);
}
