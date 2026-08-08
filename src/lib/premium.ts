import { LNBITS_URL } from '@/lib/lnbits';

/**
 * Paid relay access, sold through LNbits pay links.
 *
 * The link ids are configuration rather than something the app creates. A pay
 * link belongs to the platform's own wallet, and creating one needs that
 * wallet's admin key — which cannot live in a static site. So the links are
 * made once in LNbits and referenced here.
 */
export interface PremiumPlan {
  id: PlanId;
  name: string;
  /** What paying actually buys, in plain words. */
  summary: string;
  /** LNbits pay link id, from the /lnurlp/link/<id> URL. */
  linkId: string;
  /** Whether access, once bought, ever lapses. */
  recurring: boolean;
}

export type PlanId = 'monthly' | 'lifetime';

/** Pulls the link id out of a pasted LNbits pay link URL, or passes an id through. */
export function parseLinkId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const match = trimmed.match(/\/lnurlp\/(?:link\/)?([A-Za-z0-9]+)/);
  return match ? match[1] : trimmed;
}

export const PREMIUM_PLANS: PremiumPlan[] = [
  {
    id: 'monthly',
    name: 'Monthly access',
    summary: 'Write to the NostrFeed relay for a month.',
    linkId: parseLinkId(import.meta.env.VITE_PREMIUM_MONTHLY_LINK || ''),
    recurring: true,
  },
  {
    id: 'lifetime',
    name: 'Lifetime write access',
    summary: 'Write to the NostrFeed relay permanently. Paid once.',
    linkId: parseLinkId(import.meta.env.VITE_PREMIUM_LIFETIME_LINK || ''),
    recurring: false,
  },
];

export function configuredPlans(): PremiumPlan[] {
  return PREMIUM_PLANS.filter((plan) => !!plan.linkId);
}

/**
 * The LNURL for a pay link.
 *
 * Built from the id rather than read from the API's `lnurl` field, which is
 * deprecated — LNbits asks clients to construct the `lnurlp://` form
 * themselves so the bech32 encoding stops being served at all.
 */
export function payLinkLnurl(linkId: string): string {
  const host = LNBITS_URL.replace(/^https?:\/\//, '');
  return `lnurlp://${host}/lnurlp/${linkId}`;
}

/** The human-facing page for a pay link, for paying from another wallet. */
export function payLinkUrl(linkId: string): string {
  return `${LNBITS_URL}/lnurlp/link/${linkId}`;
}

/**
 * The comment sent with a payment, naming who it was for.
 *
 * A pay link is shared by everyone, so a payment is otherwise anonymous and
 * the operator has no way to tell which account bought access. The npub in the
 * comment is what makes it reconcilable.
 *
 * Truncated to whatever the link allows: LNbits rejects a comment longer than
 * the link's `comment_chars`, and a link created with the default of zero
 * accepts none at all.
 */
export function buildPaymentComment(
  npub: string,
  planName: string,
  maxChars: number
): string {
  if (maxChars <= 0) return '';

  const full = `${planName} for ${npub}`;
  if (full.length <= maxChars) return full;

  // The npub identifies the buyer; the plan name is already known from the
  // link, so it is the part worth dropping when space is short.
  return npub.length <= maxChars ? npub : '';
}

/** Amounts a pay link accepts, in sats. */
export interface PayLinkTerms {
  minSats: number;
  maxSats: number;
  commentChars: number;
  description: string;
}

/** Whether a link is priced at a single fixed amount. */
export function isFixedPrice(terms: PayLinkTerms): boolean {
  return terms.minSats === terms.maxSats;
}
