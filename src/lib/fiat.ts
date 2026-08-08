import type { PlanId } from '@/lib/premium';

/**
 * Card and PayPal subscriptions, through LNbits' fiat providers.
 *
 * LNbits brokers the recurring charge: the plan lives with the provider
 * (a PayPal billing plan, a Stripe price), and LNbits credits the receiving
 * wallet each time one settles. So the ids here are configuration — they are
 * created once in the provider's own dashboard and referenced by id.
 */
export type FiatProvider = 'paypal' | 'stripe' | 'square' | 'revolut';

export const FIAT_PROVIDER_LABELS: Record<FiatProvider, string> = {
  paypal: 'PayPal',
  stripe: 'Card',
  square: 'Card',
  revolut: 'Card',
};

/** Every provider LNbits can broker, in the order we would rather use them. */
export const FIAT_PROVIDERS: FiatProvider[] = [
  'paypal',
  'stripe',
  'square',
  'revolut',
];

export function isFiatProvider(value: string): value is FiatProvider {
  return (FIAT_PROVIDERS as string[]).includes(value);
}

/** A provider-side plan that buys one of our access tiers. */
export interface FiatPlan {
  planId: PlanId;
  provider: FiatProvider;
  /** The provider's own subscription/plan id, e.g. a PayPal `P-...` plan. */
  subscriptionId: string;
}

/**
 * The provider used for fiat, and the plan ids that map onto our tiers.
 *
 * One provider rather than a matrix: a plan id only means anything to the
 * provider that issued it, and offering the same tier through two providers
 * means maintaining two plans that must not drift apart in price.
 */
const PROVIDER = (import.meta.env.VITE_FIAT_PROVIDER || 'paypal').toLowerCase();

export const FIAT_PROVIDER: FiatProvider = isFiatProvider(PROVIDER)
  ? PROVIDER
  : 'paypal';

const CONFIGURED: FiatPlan[] = [
  {
    planId: 'monthly',
    provider: FIAT_PROVIDER,
    subscriptionId: (import.meta.env.VITE_PREMIUM_MONTHLY_FIAT_PLAN || '').trim(),
  },
  {
    planId: 'lifetime',
    provider: FIAT_PROVIDER,
    subscriptionId: (import.meta.env.VITE_PREMIUM_LIFETIME_FIAT_PLAN || '').trim(),
  },
];

export const FIAT_PLANS: FiatPlan[] = CONFIGURED.filter(
  (plan) => !!plan.subscriptionId
);

export function fiatPlanFor(planId: PlanId): FiatPlan | undefined {
  return FIAT_PLANS.find((plan) => plan.planId === planId);
}

/** How LNbits names a subscription when it credits the receiving wallet. */
export interface SubscriptionOptions {
  memo: string;
  wallet_id: string;
  subscription_request_id: string;
  customer_email?: string;
  success_url: string;
}

/**
 * A request id that ties a fiat subscription back to a Nostr account.
 *
 * A card payment carries no Nostr identity of its own, so without this the
 * operator sees a PayPal subscription and has no way to tell whose relay
 * access it bought. Prefixed and truncated to stay inside whatever length the
 * provider allows for a reference.
 */
export function subscriptionRequestId(npub: string, planId: PlanId): string {
  return `nostrfeed-${planId}-${npub.slice(0, 32)}`;
}

/** Whether a response from LNbits actually carries somewhere to send the payer. */
export function readCheckoutUrl(body: {
  ok?: boolean;
  checkout_session_url?: string;
  error_message?: string;
}): string {
  if (body.ok === false || !body.checkout_session_url) {
    throw new Error(
      body.error_message || 'The payment provider did not return a checkout page'
    );
  }

  return body.checkout_session_url;
}
