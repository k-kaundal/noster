import { useState } from 'react';
import {
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { usePremium } from '@/hooks/usePremium';
import { usePayAnyWallet, type PayOption } from '@/hooks/usePayAnyWallet';
import { useFiatSubscription } from '@/hooks/useFiatSubscription';
import { FIAT_PROVIDER_LABELS } from '@/lib/fiat';
import { useToast } from '@/hooks/useToast';
import { useRelayInfo } from '@/hooks/useRelayInfo';
import { useRouteSeo } from '@/hooks/useSeo';
import { HOUSE_RELAY } from '@/contexts/AppContext';
import {
  isFixedPrice,
  payLinkUrl,
  type PayLinkTerms,
  type PremiumPlan,
} from '@/lib/premium';
import type { LnurlPayMetadata } from '@/lib/lnurlPay';

interface PreparedPayment {
  plan: PremiumPlan;
  bolt11: string;
  metadata: LnurlPayMetadata;
  amountSats: number;
}
import { relayDisplayName } from '@/lib/relay';

export function PremiumPage() {
  useRouteSeo('/premium');

  const { user } = useCurrentUser();
  const { plans, terms, hasPurchase, prepare, isPreparing, recordPurchase } =
    usePremium();

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={Sparkles}
          title="Relay access"
          description="Paid write access to the NostrFeed relay. Reading is always free."
        />

        <RelayStatusCard />

        {!plans.length ? (
          <EmptyState
            icon={Sparkles}
            title="No plans configured"
            description="Set VITE_PREMIUM_MONTHLY_LINK and VITE_PREMIUM_LIFETIME_LINK to the pay link ids from LNbits."
          />
        ) : !user ? (
          <EmptyState
            icon={Sparkles}
            title="Log in to buy access"
            description="Access is tied to your Nostr key, so the relay knows which account paid."
            action={<LoginArea className="mx-auto max-w-60" />}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {terms.map(({ plan, data, isLoading, error }) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                terms={data}
                isLoading={isLoading}
                error={error}
                purchased={hasPurchase(plan.id)}
                isPreparing={isPreparing}
                onPrepare={(amountSats) =>
                  prepare({ planId: plan.id, amountSats })
                }
                onPaid={(hash) => recordPurchase(plan.id, hash)}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

/**
 * What the relay itself says about access.
 *
 * This is the only trustworthy answer on the page. Everything else describes
 * what was paid; the relay decides what that bought, and its NIP-11 document
 * is where it says so.
 */
function RelayStatusCard() {
  const { config } = useAppContext();
  const relayUrl = config.relayUrl || HOUSE_RELAY;
  const { data: info, isLoading } = useRelayInfo(relayUrl);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          {relayDisplayName(relayUrl)}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-2 text-sm">
        {isLoading ? (
          <Skeleton className="h-4 w-56" />
        ) : (
          <>
            <p className="text-muted-foreground">
              {info?.limitation?.payment_required
                ? 'This relay requires payment to write. Reading stays open.'
                : info?.limitation?.restricted_writes
                  ? 'This relay restricts who can write to it.'
                  : 'This relay is not currently advertising paid writes.'}
            </p>

            <p className="text-xs text-muted-foreground">
              The relay decides who can post, not this page. Once your payment
              reaches it, writing starts working — nothing here unlocks it.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PlanCard({
  plan,
  terms,
  isLoading,
  error,
  purchased,
  isPreparing,
  onPrepare,
  onPaid,
}: {
  plan: PremiumPlan;
  terms?: PayLinkTerms;
  isLoading: boolean;
  error?: Error;
  purchased: boolean;
  isPreparing: boolean;
  onPrepare: (amountSats: number) => Promise<PreparedPayment>;
  onPaid: (paymentHash: string) => void;
}) {
  const { options, pay, isPaying, balanceSats } = usePayAnyWallet();
  const [payingId, setPayingId] = useState<string | null>(null);
  const { toast } = useToast();

  // A link with a range lets the payer choose; a fixed price does not
  const fixed = terms ? isFixedPrice(terms) : true;
  const [amount, setAmount] = useState('');
  const [invoice, setInvoice] = useState('');

  const chosen = Number(amount) || terms?.minSats || 0;

  const start = async (option: PayOption) => {
    setPayingId(option.id);

    try {
      const prepared = await onPrepare(chosen);

      if (option.method === 'manual') {
        // Nothing to await — the person pays it wherever they like
        setInvoice(prepared.bolt11);
        return;
      }

      await pay({
        bolt11: prepared.bolt11,
        optionId: option.id,
        amountSats: chosen,
      });
      onPaid(prepared.bolt11.slice(0, 64));

      toast({
        title: 'Payment sent',
        description: 'The relay grants access once it sees it.',
      });
    } finally {
      setPayingId(null);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-baseline justify-between gap-2 text-base">
          <span>{plan.name}</span>
          {!plan.recurring && (
            <span className="text-eyebrow shrink-0">One payment</span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="text-sm text-muted-foreground">{plan.summary}</p>

        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : error ? (
          <p className="text-sm text-destructive">
            Couldn't load the price: {error.message}
          </p>
        ) : (
          terms && (
            <p className="text-title tabular">
              {fixed
                ? `${terms.minSats.toLocaleString()} sats`
                : `${terms.minSats.toLocaleString()}–${terms.maxSats.toLocaleString()} sats`}
            </p>
          )
        )}

        {!fixed && terms && (
          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={`${terms.minSats}`}
            inputMode="numeric"
            aria-label="Amount in sats"
          />
        )}

        {invoice && (
          <ManualInvoice invoice={invoice} onDone={() => setInvoice('')} />
        )}

        <div className="mt-auto space-y-2 pt-2">
          {purchased && (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <Check className="h-4 w-4" />
              Paid from this account
            </p>
          )}

          {/* Every wallet the person actually has, rather than only ours */}
          {options.map((option, index) => (
            <Button
              key={option.id}
              variant={index === 0 ? 'default' : 'outline'}
              className="w-full"
              disabled={!terms || isPreparing || isPaying}
              onClick={() => start(option)}
            >
              {/* The spinner belongs on the button that was pressed, not on
                  whichever one happened to be listed first */}
              {(isPreparing || isPaying) && payingId === option.id ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : option.method === 'manual' ? (
                <Copy className="mr-2 h-4 w-4" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              {option.label}
            </Button>
          ))}

          {options.some((option) => option.method === 'nostrfeed') && (
            <p className="text-xs text-muted-foreground">
              Balance: {balanceSats.toLocaleString()} sats
            </p>
          )}

          <FiatOption plan={plan} />

          <a
            href={payLinkUrl(plan.linkId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Open the payment page
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Paying with a card or PayPal instead of sats.
 *
 * Only offered when there is a plan configured with the provider *and* the
 * signed-in account is allowed to use it — LNbits limits providers per
 * account, and a button that leads to a refusal is worse than no button.
 */
function FiatOption({ plan }: { plan: PremiumPlan }) {
  const {
    isConfigured,
    available,
    planFor,
    subscriptionFor,
    start,
    isStarting,
    cancel,
    isCancelling,
  } = useFiatSubscription();

  const fiat = planFor(plan.id);
  const existing = subscriptionFor(plan.id);

  // No plan id, no house wallet, or the account cannot use this provider
  if (!fiat || !isConfigured) return null;
  if (available.length > 0 && !available.includes(fiat.provider)) return null;

  const label = FIAT_PROVIDER_LABELS[fiat.provider];

  if (existing) {
    return (
      <div className="space-y-1.5 rounded-lg border border-success/40 bg-success/10 p-3">
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" />
          {label} subscription active
        </p>
        <p className="text-xs text-muted-foreground">
          Renews automatically. Started{' '}
          {new Date(existing.startedAt * 1000).toLocaleDateString()}.
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={isCancelling}
          onClick={() => cancel(existing)}
        >
          {isCancelling && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Cancel subscription
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      className="w-full"
      disabled={isStarting}
      onClick={() => start({ plan, fiat })}
    >
      {isStarting ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <CreditCard className="mr-2 h-4 w-4" />
      )}
      Pay with {label}
    </Button>
  );
}

/**
 * The invoice, for paying from somewhere this browser cannot reach.
 *
 * There is no completion signal here — the payment happens on another device,
 * so the page cannot know when it lands. Saying so is better than a spinner
 * that never resolves.
 */
function ManualInvoice({
  invoice,
  onDone,
}: {
  invoice: string;
  onDone: () => void;
}) {
  const { toast } = useToast();

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="break-all font-mono text-[11px] text-muted-foreground">
        {invoice.slice(0, 80)}…
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(invoice);
            toast({ title: 'Invoice copied' });
          }}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Pay this from any wallet. Access follows once the relay sees it.
      </p>
    </div>
  );
}

export default PremiumPage;
