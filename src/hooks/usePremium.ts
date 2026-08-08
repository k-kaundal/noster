import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useToast } from '@/hooks/useToast';
import { lnbitsRequest } from '@/lib/lnbits';
import {
  buildPaymentComment,
  configuredPlans,
  payLinkLnurl,
  type PayLinkTerms,
  type PlanId,
  type PremiumPlan,
} from '@/lib/premium';

/** A payment this device made, kept so the UI can show what was bought. */
interface PurchaseRecord {
  planId: PlanId;
  paymentHash: string;
  /** Seconds since epoch. */
  paidAt: number;
}

/**
 * Reads the public terms of a pay link.
 *
 * Public on purpose — this endpoint needs no key, so the price can be shown to
 * someone who has not connected a wallet yet.
 */
function usePlanTerms(plans: PremiumPlan[]) {
  return useQueries({
    queries: plans.map((plan) => ({
      queryKey: ['paylink-public', plan.linkId],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const body = await lnbitsRequest<Record<string, unknown>>(
          `/lnurlp/api/v1/links/public/${plan.linkId}`,
          { signal }
        );

        return {
          minSats: Number(body.min ?? 0),
          maxSats: Number(body.max ?? 0),
          commentChars: Number(body.comment_chars ?? 0),
          description: String(body.description ?? plan.summary),
        } satisfies PayLinkTerms;
      },
      staleTime: 10 * 60 * 1000,
      retry: false,
    })),
  });
}

/**
 * Buying paid relay access.
 *
 * What this hook does *not* do is decide whether someone has access. That is
 * the relay's job — it is the thing that accepts or rejects the write, and a
 * flag in the browser can be set by anyone with devtools. The records here
 * exist so the UI can show what was paid for and when, not to unlock anything.
 */
export function usePremium() {
  const { user } = useCurrentUser();
  const { wallet, balanceSats } = useLnbitsWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const plans = configuredPlans();
  const terms = usePlanTerms(plans);

  // Keyed by pubkey: purchases belong to an account, not to a browser
  const [purchases, setPurchases] = useLocalStorage<
    Record<string, PurchaseRecord[]>
  >('nostrfeed:premium', {});

  const mine = user ? (purchases[user.pubkey] ?? []) : [];

  const buy = useMutation({
    mutationFn: async ({
      planId,
      amountSats,
    }: {
      planId: PlanId;
      amountSats: number;
    }) => {
      if (!user) throw new Error('Log in with Nostr first');
      if (!wallet) throw new Error('Connect your NostrFeed wallet first');

      const plan = plans.find((entry) => entry.id === planId);
      if (!plan) throw new Error('That plan is not available');

      const index = plans.indexOf(plan);
      const planTerms = terms[index]?.data;

      if (amountSats > balanceSats) {
        throw new Error(
          `Not enough sats. You have ${balanceSats}, this costs ${amountSats}.`
        );
      }

      const comment = buildPaymentComment(
        nip19.npubEncode(user.pubkey),
        plan.name,
        planTerms?.commentChars ?? 0
      );

      const payment = await lnbitsRequest<Record<string, unknown>>(
        '/api/v1/payments/lnurl',
        {
          method: 'POST',
          apiKey: wallet.adminkey,
          body: {
            lnurl: payLinkLnurl(plan.linkId),
            // This endpoint is in millisats, unlike /api/v1/payments
            amount: amountSats * 1000,
            ...(comment ? { comment } : {}),
          },
        }
      );

      return {
        planId,
        paymentHash: String(payment.payment_hash ?? ''),
        paidAt: Math.floor(Date.now() / 1000),
      } satisfies PurchaseRecord;
    },
    onSuccess: (record) => {
      if (user) {
        setPurchases((current) => ({
          ...current,
          [user.pubkey]: [...(current[user.pubkey] ?? []), record],
        }));
      }

      queryClient.invalidateQueries({ queryKey: ['lnbits-wallets'] });
      queryClient.invalidateQueries({ queryKey: ['lnbits-payments'] });

      toast({
        title: 'Payment sent',
        description:
          'The relay grants access once it sees the payment. Give it a moment.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Payment failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    plans,
    terms: plans.map((plan, index) => ({
      plan,
      data: terms[index]?.data,
      isLoading: terms[index]?.isLoading ?? false,
      error: terms[index]?.error as Error | undefined,
    })),
    purchases: mine,
    hasPurchase: (planId: PlanId) =>
      mine.some((record) => record.planId === planId),
    buy: buy.mutateAsync,
    isBuying: buy.isPending,
    canPay: !!wallet,
    balanceSats,
  };
}
