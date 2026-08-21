import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { QrCode } from '@/components/wallet/QrCode';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePremium } from '@/hooks/usePremium';
import { useRelays } from '@/hooks/useRelays';
import {
  useAdmission,
  useAdmissionInvoice,
  useInvoiceWatcher,
  usePaidRelayInfo,
} from '@/hooks/usePaidRelay';
import { usePayAnyWallet, type PayOption } from '@/hooks/usePayAnyWallet';
import { useFiatSubscription } from '@/hooks/useFiatSubscription';
import { FIAT_PROVIDER_LABELS } from '@/lib/fiat';
import { useToast } from '@/hooks/useToast';
import { useRouteSeo } from '@/hooks/useSeo';
import {
  PAID_RELAY_URL,
  admissionPayUrl,
  describeAdmission,
  type AdmissionInvoice as AdmissionInvoiceValue,
  type AdmissionState as AdmissionStateValue,
} from '@/lib/paidRelay';
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
          description="Writing to the paid relay is bought once. Reading is free, everywhere, always."
        />

        <AdmissionCard />

        {/*
          The older pay links, kept and labelled for what they are.

          These settle into the LNbits wallet rather than through nostream, so
          paying one does not admit anybody — the relay never learns about it.
          Left in place because they may still be selling something the
          operator honours by hand, and removing a payment path quietly is not
          this page's call to make. What is this page's call is not implying
          they buy relay access.
        */}
        {plans.length > 0 && user && (
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Other plans</h2>
              <p className="text-xs text-muted-foreground">
                These are billed through LNbits, separately from the relay.
                Paying one does not admit your key above.
              </p>
            </div>

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
          </section>
        )}
      </div>
    </Layout>
  );
}

/**
 * Where this account stands with the paid relay, and how to change it.
 *
 * The whole card is built around one rule: the relay is the only authority.
 * The page used to say "Paid from this account" out of a `localStorage`
 * record — a sentence anybody with devtools can produce, which stayed true
 * after a refund and false after paying from another device. It asks the relay
 * instead, and when the relay cannot be reached it says so rather than
 * guessing.
 */
function AdmissionCard() {
  const { user } = useCurrentUser();
  const { state, isLoading, refetch, confirm, isChecking } = useAdmission();
  const relay = usePaidRelayInfo();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          {relayDisplayName(PAID_RELAY_URL)}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {relay.isLoading ? (
          <Skeleton className="h-4 w-56" />
        ) : !relay.live ? (
          /*
           * The state this deployment is in until certbot has run on the
           * relay's host: the fetch reaches nginx's default page rather than a
           * NIP-11 document. Quoting a price nobody can pay would be worse
           * than saying the relay is not answering yet.
           */
          <p className="rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm text-warning-strong">
            This relay isn't answering yet. Its certificate or its nostream
            process may still be coming up — nothing can be bought until it is.
          </p>
        ) : (
          <>
            {/*
              `paid` comes from NIP-11 and the price from the invoice
              endpoint, and they fail independently — so a quoted price is
              itself evidence the relay charges, and saying "not advertising
              paid writes" beside a real fee would be the page arguing with
              itself.
            */}
            <p className="text-sm text-muted-foreground">
              {relay.paid || relay.feeFromRelay
                ? 'Writing here costs a one-time admission per key. Reading stays open to everyone, and this never has to be paid twice.'
                : "This relay isn't advertising paid writes right now."}
            </p>

            <p className="text-title tabular">
              {relay.feeSats.toLocaleString()} sats
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                once, per account
              </span>
            </p>

            {/*
              Whose number this is. The operator changes the price in
              nostream's settings and restarts; a figure compiled into a static
              site goes stale at that moment, and the stale direction produces
              an underpaid invoice and no admission.
            */}
            {!relay.feeFromRelay && (
              <p className="text-xs text-muted-foreground">
                The relay didn't quote a price, so this is our last known one.
                Check the amount on the invoice before paying.
              </p>
            )}
          </>
        )}

        {!user ? (
          <div className="space-y-3 rounded-lg border border-dashed p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Admission is tied to your key, so the relay knows which account
              paid.
            </p>
            <LoginArea className="mx-auto max-w-60" />
          </div>
        ) : isLoading ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : (
          <AdmissionState
            state={state}
            feeSats={relay.feeSats}
            live={relay.live}
            pubkey={user.pubkey}
            termsUrl={relay.info?.terms_of_service}
            onRecheck={() => void refetch()}
            onPaid={() => void confirm()}
            isChecking={isChecking}
          />
        )}
      </CardContent>
    </Card>
  );
}

function AdmissionState({
  state,
  feeSats,
  live,
  pubkey,
  termsUrl,
  onRecheck,
  onPaid,
  isChecking,
}: {
  state: AdmissionStateValue;
  feeSats: number;
  live: boolean;
  pubkey: string;
  /** The relay's own terms, from its NIP-11 document. */
  termsUrl?: string;
  onRecheck: () => void;
  /** Waits for the payment to register, rather than asking once. */
  onPaid: () => void;
  isChecking: boolean;
}) {
  if (state === 'admitted') {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success-strong">
          <Check className="h-4 w-4 shrink-0" />
          {describeAdmission(state)}
        </p>
        <AddToRelayList />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p
        className={
          state === 'unpaid'
            ? 'text-sm text-muted-foreground'
            : 'rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm text-warning-strong'
        }
      >
        {describeAdmission(state)}
        {state === 'unknown' && (
          <>
            {' '}
            You may already have paid — this doesn't mean you haven't. Paying
            below checks first and charges nothing if you are already in.
          </>
        )}
      </p>

      {live && (
        <BuyAdmission
          feeSats={feeSats}
          pubkey={pubkey}
          termsUrl={termsUrl}
          onPaid={onPaid}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRecheck}
          disabled={isChecking}
        >
          {isChecking && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Check again
        </Button>

        {/*
          The last resort, and named as one. Paying belongs in the app — this
          is here for the case where the relay cannot be reached from this
          origin at all, which is a configuration this page cannot fix.
        */}
        <a
          href={admissionPayUrl(pubkey)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Pay on the web instead
        </a>
      </div>
    </div>
  );
}

/**
 * Paying admission without leaving the app.
 *
 * Deliberately the whole flow: terms, invoice, QR, wallet, and the wait. The
 * relay runs a perfectly good web page for this, and sending somebody out to a
 * browser tab to buy something loses most of them at the door — they lose the
 * app's wallet, the app loses any idea whether they came back, and the person
 * is left pasting their own npub into a form.
 *
 * The invoice is settled by whichever wallet they actually have. That is the
 * one improvement over the integration notes worth naming: those call
 * `window.webln` directly, which is the only wallet a person may not have.
 */
function BuyAdmission({
  feeSats,
  pubkey,
  termsUrl,
  onPaid,
}: {
  feeSats: number;
  pubkey: string;
  termsUrl?: string;
  onPaid: () => void;
}) {
  const { mutateAsync: createInvoice, isPending: isCreating } =
    useAdmissionInvoice();
  const watchInvoice = useInvoiceWatcher();
  const { options, pay, isPaying, balanceSats } = usePayAnyWallet();
  const { toast } = useToast();

  const [accepted, setAccepted] = useState(false);
  const [invoice, setInvoice] = useState<AdmissionInvoiceValue | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  /*
   * Aborted when the invoice is dismissed, so closing this stops the polling
   * rather than leaving it running against the relay for the life of the tab.
   */
  const watcher = useRef<AbortController | null>(null);

  useEffect(() => () => watcher.current?.abort(), []);

  const dismiss = () => {
    watcher.current?.abort();
    watcher.current = null;
    setInvoice(null);
    setWaiting(false);
  };

  /** Starts polling for one invoice, and reports however it ends. */
  const watch = async (created: AdmissionInvoiceValue) => {
    watcher.current?.abort();
    const controller = new AbortController();
    watcher.current = controller;

    setWaiting(true);

    try {
      const outcome = await watchInvoice(created, pubkey, controller.signal);

      if (outcome === 'paid') {
        toast({ title: "You're in", description: 'The relay accepts your writes now.' });
        setInvoice(null);
        onPaid();
      } else if (outcome === 'expired') {
        toast({
          title: 'That invoice expired',
          description: 'Nothing was charged. Create another to try again.',
          variant: 'destructive',
        });
        setInvoice(null);
      }
      // 'gave-up' leaves the invoice on screen: it may still be payable, and
      // removing it would throw away a bolt11 somebody is midway through
    } finally {
      setWaiting(false);
    }
  };

  const create = async (): Promise<AdmissionInvoiceValue | null> => {
    const created = await createInvoice().catch(() => null);
    if (!created) return null;

    /*
     * The key was already admitted, so the relay returned no invoice. Saying
     * so and charging nothing is the whole point of checking — this is the
     * path that stops somebody paying twice.
     */
    if (created.userAdmitted) {
      toast({ title: "You're already in", description: 'Nothing to pay.' });
      onPaid();
      return null;
    }

    setInvoice(created);
    void watch(created);
    return created;
  };

  const start = async (option: PayOption) => {
    setPayingId(option.id);

    try {
      const created = invoice ?? (await create());
      if (!created?.bolt11) return;

      await pay({
        bolt11: created.bolt11,
        optionId: option.id,
        amountSats: created.amountSats || feeSats,
      });

      // The relay decides, not the wallet — `watch` is already asking it
    } catch {
      // Both mutations toast their own failures
    } finally {
      setPayingId(null);
    }
  };

  const amount = invoice?.amountSats || feeSats;

  return (
    <div className="space-y-3">
      {/*
        Ticked by the person, never on their behalf. The relay requires
        `tosAccepted` on the invoice request, and sending it for somebody who
        was never shown the terms is agreeing to something on their account.
      */}
      {!invoice && (
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={accepted}
            onCheckedChange={(value) => setAccepted(value === true)}
            className="mt-0.5"
            aria-label="Accept the relay's terms of service"
          />
          <span>
            I accept the{' '}
            <a
              href={termsUrl || admissionPayUrl(pubkey)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              relay's terms of service
            </a>
            .
          </span>
        </label>
      )}

      {invoice?.bolt11 && (
        <div className="space-y-3 rounded-lg border p-4">
          <QrCode
            value={`lightning:${invoice.bolt11}`}
            label={`Lightning invoice for ${amount.toLocaleString()} sats`}
            size={180}
          />

          <p className="text-center text-sm">
            <span className="tabular-nums font-semibold">
              {amount.toLocaleString()} sats
            </span>
            <span className="text-muted-foreground"> — scan or pay below</span>
          </p>

          {waiting && (
            <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Waiting for the relay to see the payment…
            </p>
          )}

          <div className="flex justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(invoice.bolt11!);
                toast({ title: 'Invoice copied' });
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {options.map((option, index) => (
        <Button
          key={option.id}
          variant={index === 0 ? 'default' : 'outline'}
          className="w-full"
          disabled={!accepted || isCreating || isPaying}
          onClick={() => start(option)}
        >
          {(isCreating || isPaying) && payingId === option.id ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : option.method === 'manual' ? (
            <Copy className="mr-2 h-4 w-4" />
          ) : (
            <Zap className="mr-2 h-4 w-4" />
          )}
          {option.label} · {amount.toLocaleString()} sats
        </Button>
      ))}

      {options.some((option) => option.method === 'nostrfeed') && (
        <p className="text-xs text-muted-foreground">
          Balance: {balanceSats.toLocaleString()} sats
        </p>
      )}
    </div>
  );
}

/**
 * Adding the paid relay to the set this app writes to.
 *
 * Admission is worth nothing on its own — the relay will accept writes that
 * are never sent to it. Added write-only, which is the NIP-65 marker the relay
 * list already understands: notes go there, and reads keep coming from the
 * free relay, which is faster and has everybody else's posts on it.
 */
function AddToRelayList() {
  const { relays, addRelay } = useRelays();
  const { toast } = useToast();

  const already = relays.some((relay) => relay.url === PAID_RELAY_URL);

  if (already) {
    return (
      <p className="text-xs text-muted-foreground">
        This relay is in your list. Publish it from{' '}
        <Link to="/relays" className="underline hover:text-foreground">
          Relays
        </Link>{' '}
        so other clients know to read you there.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm">
        Your notes aren't being sent here yet.
      </p>
      <p className="text-xs text-muted-foreground">
        Admission only means the relay will accept them. Adding it as a write
        relay is what actually sends them.
      </p>
      <Button
        size="sm"
        onClick={() => {
          // Write-only: reads stay on the free relay, which is where everyone
          // else's notes are
          if (addRelay(PAID_RELAY_URL, { read: false, write: true })) {
            toast({
              title: 'Added as a write relay',
              description: 'Publish your relay list so other clients follow.',
            });
          }
        }}
      >
        Add as a write relay
      </Button>
    </div>
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
