import { useMutation } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useToast } from '@/hooks/useToast';
import { HOUSE_WALLET, hasHouseWallet, lnbitsRequest } from '@/lib/lnbits';
import {
  FIAT_PROVIDER_LABELS,
  fiatPlanFor,
  readCheckoutUrl,
  subscriptionRequestId,
  type FiatPlan,
} from '@/lib/fiat';
import type { PlanId, PremiumPlan } from '@/lib/premium';

/** A subscription started from this browser, so it can be shown and cancelled. */
export interface FiatSubscriptionRecord {
  planId: PlanId;
  provider: string;
  requestId: string;
  startedAt: number;
}

interface StartVariables {
  plan: PremiumPlan;
  fiat: FiatPlan;
  /** Where the provider sends the payer back to. */
  email?: string;
}

/**
 * Buying relay access with a card or PayPal.
 *
 * The recurring charge is brokered by LNbits: the plan itself lives with the
 * provider, and LNbits credits the receiving wallet when each period settles.
 * That receiving wallet has to be ours — a subscription created against the
 * buyer's own wallet would top *them* up rather than pay for anything.
 *
 * Which is why this needs the house wallet's invoice key. That key can receive
 * and read a balance but cannot spend, so publishing it in a static bundle
 * costs us visibility of one balance rather than the money in it.
 */
export function useFiatSubscription() {
  const { user } = useCurrentUser();
  const { account } = useLnbitsAuth();
  const { toast } = useToast();

  // Kept per Nostr account: a subscription belongs to whoever bought it
  const [records, setRecords] = useLocalStorage<
    Record<string, FiatSubscriptionRecord[]>
  >('nostrfeed:fiat-subs', {});

  const mine = user ? (records[user.pubkey] ?? []) : [];

  /**
   * Providers this account can actually use.
   *
   * LNbits reports them per account, because a provider can be limited to
   * particular users. Offering a payment method the server will refuse is a
   * dead end discovered only after the person has committed to paying.
   */
  const available = account?.fiat_providers ?? [];

  const start = useMutation({
    mutationFn: async ({ plan, fiat, email }: StartVariables) => {
      if (!user) throw new Error('Log in first');
      if (!hasHouseWallet()) {
        throw new Error(
          'Card payments are not configured. Set VITE_LNBITS_WALLET_ID and VITE_LNBITS_INVOICE_KEY.'
        );
      }

      const npub = nip19.npubEncode(user.pubkey);
      const requestId = subscriptionRequestId(npub, plan.id);

      const body = await lnbitsRequest<{
        ok?: boolean;
        subscription_request_id?: string;
        checkout_session_url?: string;
        error_message?: string;
      }>(`/api/v1/fiat/${fiat.provider}/subscription`, {
        method: 'POST',
        apiKey: HOUSE_WALLET.invoiceKey,
        body: {
          subscription_id: fiat.subscriptionId,
          quantity: 1,
          payment_options: {
            // The npub is the only thing tying a card payment to an account
            memo: `${plan.name} for ${npub}`,
            wallet_id: HOUSE_WALLET.id,
            subscription_request_id: requestId,
            customer_email: email || undefined,
            success_url: `${window.location.origin}/premium`,
          },
        },
      });

      return {
        planId: plan.id,
        provider: fiat.provider,
        requestId: body.subscription_request_id || requestId,
        checkoutUrl: readCheckoutUrl(body),
      };
    },
    onSuccess: (result) => {
      if (user) {
        setRecords((current) => ({
          ...current,
          [user.pubkey]: [
            ...(current[user.pubkey] ?? []).filter(
              (record) => record.requestId !== result.requestId
            ),
            {
              planId: result.planId,
              provider: result.provider,
              requestId: result.requestId,
              startedAt: Math.floor(Date.now() / 1000),
            },
          ],
        }));
      }

      // Leaving for the provider's own checkout is the whole point, so this
      // navigates rather than opening a tab a popup blocker would swallow
      window.location.href = result.checkoutUrl;
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not start the subscription',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const cancel = useMutation({
    mutationFn: async (record: FiatSubscriptionRecord) => {
      await lnbitsRequest(
        `/api/v1/fiat/${record.provider}/subscription/${encodeURIComponent(record.requestId)}`,
        { method: 'DELETE', apiKey: HOUSE_WALLET.invoiceKey }
      );
      return record;
    },
    onSuccess: (record) => {
      if (user) {
        setRecords((current) => ({
          ...current,
          [user.pubkey]: (current[user.pubkey] ?? []).filter(
            (entry) => entry.requestId !== record.requestId
          ),
        }));
      }
      toast({ title: 'Subscription cancelled' });
    },
    onError: (error: Error, record) => {
      const label =
        FIAT_PROVIDER_LABELS[
          record.provider as keyof typeof FIAT_PROVIDER_LABELS
        ] ?? record.provider;

      toast({
        title: 'Could not cancel it here',
        description: `${error.message} You can always cancel from your ${label} account.`,
        variant: 'destructive',
      });
    },
  });

  return {
    /** Whether the app is configured to sell through a fiat provider at all. */
    isConfigured: hasHouseWallet(),
    available,
    subscriptions: mine,
    subscriptionFor: (planId: PlanId) =>
      mine.find((record) => record.planId === planId),
    planFor: fiatPlanFor,
    start: start.mutateAsync,
    isStarting: start.isPending,
    cancel: cancel.mutateAsync,
    isCancelling: cancel.isPending,
  };
}
