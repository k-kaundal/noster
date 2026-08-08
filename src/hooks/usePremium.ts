import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useToast } from '@/hooks/useToast';
import { lnbitsRequest } from '@/lib/lnbits';
import { fetchInvoice, fetchPayMetadata, validateAmount } from '@/lib/lnurlPay';
import {
  buildPaymentComment,
  configuredPlans,
  payLinkHttpUrl,
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

  /**
   * Turns a plan into an invoice, using only public LNURL endpoints.
   *
   * Deliberately key-free so it works before anyone has a NostrFeed wallet —
   * an invoice can then be paid from Alby, a NWC wallet, or a phone, and
   * nobody is forced to move their money here to buy access.
   */
  const prepare = useMutation({
    mutationFn: async ({
      planId,
      amountSats,
    }: {
      planId: PlanId;
      amountSats: number;
    }) => {
      const plan = plans.find((entry) => entry.id === planId);
      if (!plan) throw new Error('That plan is not available');

      const metadata = await fetchPayMetadata(payLinkHttpUrl(plan.linkId));

      const invalid = validateAmount(amountSats, metadata);
      if (invalid) throw new Error(invalid);

      const comment = user
        ? buildPaymentComment(
            nip19.npubEncode(user.pubkey),
            plan.name,
            metadata.commentAllowed
          )
        : '';

      const bolt11 = await fetchInvoice(
        metadata,
        amountSats * 1000,
        comment || undefined
      );

      return { plan, bolt11, metadata, amountSats };
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not prepare the payment',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /** Records a completed purchase so the UI can show what was bought. */
  const recordPurchase = (planId: PlanId, paymentHash: string) => {
    if (!user) return;

    setPurchases((current) => ({
      ...current,
      [user.pubkey]: [
        ...(current[user.pubkey] ?? []),
        { planId, paymentHash, paidAt: Math.floor(Date.now() / 1000) },
      ],
    }));

    queryClient.invalidateQueries({ queryKey: ['lnbits-wallets'] });
    queryClient.invalidateQueries({ queryKey: ['lnbits-payments'] });
  };

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
    prepare: prepare.mutateAsync,
    isPreparing: prepare.isPending,
    recordPurchase,
    balanceSats,
    hasNostrFeedWallet: !!wallet,
  };
}
