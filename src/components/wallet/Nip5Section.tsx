import { useState } from 'react';
import {
  BadgeCheck,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Search,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useNip5,
  useNip5Payment,
  useNip5Search,
  type PendingNip5,
} from '@/hooks/useNip5';
import { QrCode } from '@/components/wallet/QrCode';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import {
  DEFAULT_MAX_YEARS,
  daysUntilExpiry,
  describeLocalPartProblem,
  describePrice,
  formatNip5,
  expiresAt,
  nip5State,
  isZappable,
  lnAddressConfig,
  normalizeLocalPart,
  promoOutcome,
  validateLocalPart,
  yearOptions,
  type Nip5Address,
  type Nip5AddressStatus,
} from '@/lib/nip5';

/**
 * The verified half of someone's name: buying it, and keeping it alive.
 *
 * A section rather than a card, because it sits inside the identity card next
 * to the free address it upgrades. People arrive expecting `name@domain` to be
 * one thing and it is two — this is the half that costs money, expires, and
 * puts a checkmark next to their posts.
 *
 * Renders nothing when the operator hasn't set the extension up. An empty
 * space is better than an offer we cannot fulfil.
 */
export function Nip5Section() {
  const nip5 = useNip5();

  if (!nip5.isConfigured || nip5.isUnavailable) return null;

  if (nip5.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-success/10">
          <BadgeCheck className="h-3.5 w-3.5 text-success" />
        </div>
        <h3 className="text-sm font-semibold">Verified name</h3>
      </div>

      {nip5.address ? <OwnedName /> : <BuyName />}
    </div>
  );
}

function OwnedName() {
  // Publishing to the profile is deliberately not here: the identity card
  // above owns it, and writes the name and the lightning address in one event
  const { address, identifier, matchesCurrentKey } = useNip5();
  const { toast } = useToast();

  if (!address || !identifier) return null;

  const zappable = isZappable(address);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border bg-gradient-to-br from-success/5 to-transparent p-4 transition-all hover:border-success/40">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Reserved
          </p>
          <p className="font-mono font-semibold truncate text-base">{identifier}</p>
          {/* Always, not only inside the badge's thirty-day window. This is a
              name rented by the year and the date it runs out is the single
              fact about it worth knowing early — the badge appears far too
              late to plan around. */}
          <RentedUntil address={address} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ExpiryBadge address={address} />
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(identifier);
              toast({ title: 'Copied to clipboard' });
            }}
            className="hover:bg-success/10"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <LapseWarning address={address} zappable={zappable} />

      <UnpaidName address={address} />

      {!matchesCurrentKey && (
        <div className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm backdrop-blur-sm">
          <p className="text-warning-strong">
            This name verifies a different Nostr key, so it won't show a ✓ on your posts here.
          </p>
        </div>
      )}

      <LightningDestination address={address} identifier={identifier} />
    </div>
  );
}

/**
 * Which wallet a verified name pays into.
 *
 * This used to be one button that silently used whichever wallet happened to
 * be selected, and there was no way to change it afterwards — so an account
 * with a spending wallet and a savings wallet could point its public address
 * at the wrong one permanently, and the money would arrive somewhere nobody
 * thought to look.
 *
 * The endpoint creates or updates in one call, so the same form does both.
 */
function LightningDestination({
  address,
  identifier,
}: {
  address: Nip5Address;
  identifier: string;
}) {
  const { attachLightning, isAttaching, wallets } = useNip5();

  const current = lnAddressConfig(address);

  /**
   * Only what somebody picked, so the default can still move under it.
   *
   * Initialising state from the wallet list would freeze whatever was there on
   * the first render — which is nothing, because the wallets arrive from a
   * query — leaving the form permanently pointed at an empty id.
   */
  const [picked, setPicked] = useState<string | null>(null);
  const walletId = picked ?? current?.wallet ?? wallets[0]?.id ?? '';

  const named = wallets.find((entry) => entry.id === current?.wallet);
  const changed = !!current && walletId !== current.wallet;

  if (!wallets.length) return null;

  const submit = () =>
    void attachLightning({ address, walletId }).catch(() => {});

  if (current && wallets.length < 2) {
    /*
     * One wallet and already attached: there is no decision left to make, so
     * this is a statement rather than a form.
     */
    return (
      <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success-strong">
        <Zap className="h-4 w-4 shrink-0" />
        {identifier} receives payments.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-blue-200/50 bg-blue-50/50 p-4 dark:border-blue-900/30 dark:bg-blue-950/20">
      <p className="text-sm">
        {current
          ? `${identifier} receives payments. Choose where they land.`
          : `Add a lightning address so ${identifier} receives zaps as well as verifying you.`}
      </p>

      {/* Only asked when there is something to ask. A select with one option
          is a decision put in front of somebody for no reason. */}
      {wallets.length > 1 && (
        <div className="space-y-1.5">
          <Label
            htmlFor="nip5-wallet"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Pays into
          </Label>
          <Select value={walletId} onValueChange={setPicked}>
            <SelectTrigger id="nip5-wallet" className="bg-background">
              <SelectValue placeholder="Choose a wallet" />
            </SelectTrigger>
            <SelectContent>
              {wallets.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button
        size="sm"
        onClick={submit}
        disabled={isAttaching || !walletId || (!!current && !changed)}
        className="w-full"
      >
        {isAttaching ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Zap className="mr-2 h-4 w-4" />
        )}
        {current
          ? changed
            ? 'Move payments here'
            : `Paying into ${named?.name ?? 'a wallet'}`
          : 'Enable zaps'}
      </Button>
    </div>
  );
}

/**
 * A name reserved but never paid for.
 *
 * The badge said "Awaiting payment" and that was the end of it: the invoice
 * lived in component state, so a reload — or simply coming back tomorrow —
 * left a name nobody could pay and no way to reach the payment screen. It
 * looked like a bug in the purchase rather than a purchase left half done.
 *
 * Asking for the name again is what recovers it. The extension answers a
 * repeat claim for a name already reserved to this key with the same record
 * and its outstanding invoice, so nothing is bought twice and nothing new is
 * reserved.
 */
function UnpaidName({ address }: { address: Nip5Address }) {
  const { claim, isClaiming, pay, isPaying } = useNip5();
  const [pending, setPending] = useState<PendingNip5 | null>(null);
  const paid = useNip5Payment(pending?.paymentHash);

  if (nip5State(address) !== 'inactive') return null;

  if (pending && !paid.data) {
    return (
      <PendingPayment
        pending={pending}
        onPay={(optionId) => void pay({ pending, optionId }).catch(() => {})}
        isPaying={isPaying}
        onCancel={() => setPending(null)}
      />
    );
  }

  const years = address.extra?.years ?? 1;
  const sats = address.extra?.price_in_sats;

  return (
    <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/8 p-4">
      <p className="text-sm text-warning-strong">
        {formatNip5(address.local_part)} is reserved for you and not live yet.
        {sats ? ` It costs ${sats.toLocaleString()} sats.` : ''} Nobody else can
        take it in the meantime.
      </p>

      <Button
        size="sm"
        className="w-full"
        disabled={isClaiming}
        onClick={() =>
          void claim({ localPart: address.local_part, years })
            .then((result) => {
              if (result.bolt11) setPending(result);
            })
            .catch(() => {})
        }
      >
        {isClaiming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Pay for it
      </Button>
    </div>
  );
}

/** When the rental runs out, in plain words. */
function RentedUntil({ address }: { address: Nip5Address }) {
  const expiry = expiresAt(address);
  if (expiry === null) return null;

  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      Rented until {new Date(expiry).toLocaleDateString()}
    </p>
  );
}

/**
 * What lapsing actually costs.
 *
 * Two things go at once and only one of them is obvious. The checkmark stops,
 * which people expect of a name that expired — and the lightning address
 * attached to it stops with it, so zaps aimed at the name start failing. That
 * second half is worth saying before it happens rather than being worked out
 * afterwards from payments that no longer arrive.
 */
function LapseWarning({
  address,
  zappable,
}: {
  address: Nip5Address;
  zappable: boolean;
}) {
  const state = nip5State(address);
  if (state !== 'expiring' && state !== 'expired') return null;

  const days = daysUntilExpiry(address);
  const gone = state === 'expired';

  return (
    <div
      className={cn(
        'rounded-lg border p-3 text-sm',
        gone
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-warning/30 bg-warning/8'
      )}
    >
      <p className={gone ? 'text-destructive' : 'text-warning-strong'}>
        {gone
          ? `${formatNip5(address.local_part)} has expired.`
          : `${formatNip5(address.local_part)} runs out in ${days} ${
              days === 1 ? 'day' : 'days'
            }.`}{' '}
        {zappable
          ? 'The ✓ and the lightning address on this name both stop with it, so zaps sent here will fail.'
          : 'The ✓ on your posts stops with it.'}{' '}
        Reserve it again below to keep it.
      </p>
    </div>
  );
}

function ExpiryBadge({ address }: { address: Nip5Address }) {
  const state = nip5State(address);
  const days = daysUntilExpiry(address);

  if (state === 'inactive') {
    return (
      <Badge variant="outline" className="shrink-0 gap-1">
        <Clock className="h-3 w-3" />
        Awaiting payment
      </Badge>
    );
  }

  if (state === 'expired') {
    return (
      <Badge variant="destructive" className="shrink-0">
        Expired
      </Badge>
    );
  }

  if (state === 'expiring' && days !== null) {
    return (
      <Badge variant="outline" className="shrink-0 border-warning text-warning">
        {days}d left
      </Badge>
    );
  }

  return null;
}

function BuyName() {
  const { domain, claim, isClaiming, pay, isPaying, suggestedFrom } = useNip5();

  const [localPart, setLocalPart] = useState(() =>
    normalizeLocalPart(suggestedFrom)
  );
  const [years, setYears] = useState(1);
  const [promoCode, setPromoCode] = useState('');
  const [pending, setPending] = useState<PendingNip5 | null>(null);
  // Availability stays hidden until the field is used, so a prefilled
  // suggestion doesn't greet you with a validation error
  const [touched, setTouched] = useState(false);

  const search = useNip5Search(localPart, years);
  const paid = useNip5Payment(pending?.paymentHash);

  const problem = validateLocalPart(localPart);
  const available = search.data?.available === true;

  // The name goes live only once the invoice settles, so this is the moment
  // worth waiting on rather than the moment the button was pressed
  if (pending && !paid.data) {
    return (
      <PendingPayment
        pending={pending}
        // What the search said before any code was applied, so the invoice can
        // be shown as a difference rather than as a bare number
        quoted={search.data}
        // The mutations report their own failures; these catches only stop
        // an unhandled rejection reaching the console
        onPay={(optionId) => void pay({ pending, optionId }).catch(() => {})}
        isPaying={isPaying}
        onCancel={() => setPending(null)}
      />
    );
  }

  const options = yearOptions(DEFAULT_MAX_YEARS);

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-gradient-to-br from-success/8 to-success/5 p-3 dark:from-success/10 dark:to-success/5">
        <p className="text-sm text-foreground">
          A verified name shows a <span className="inline font-mono">✓</span> on your posts. Rented by the year.
        </p>
      </div>

      <div className="space-y-3">
        <Label htmlFor="nip5-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your name
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="nip5-name"
            value={localPart}
            onChange={(event) => {
              setLocalPart(normalizeLocalPart(event.target.value));
              if (!touched) setTouched(true);
            }}
            onBlur={() => setTouched(true)}
            placeholder="satoshi"
            aria-invalid={!!localPart && !!problem}
            className="max-w-[10rem] transition-all"
          />
          <span className="flex-1 truncate text-sm font-medium text-foreground">
            @{domain}
          </span>

          {options.length > 1 && (
            <Select
              value={String(years)}
              onValueChange={(value) => setYears(Number(value))}
            >
              <SelectTrigger className="w-24 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}y
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <Availability
          localPart={localPart}
          problem={problem ? describeLocalPartProblem(problem) : ''}
          isSearching={search.isFetching}
          status={search.data}
          error={search.error as Error | null}
          years={years}
          touched={touched}
        />
      </div>

      {/*
        Offered without being pushed. A prominent "have a code?" box invents
        the idea that everyone else is paying less, and somebody who has one
        will look for the field anyway.
      */}
      <div className="space-y-1.5">
        <Label
          htmlFor="nip5-promo"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Discount code (optional)
        </Label>
        <Input
          id="nip5-promo"
          value={promoCode}
          onChange={(event) => setPromoCode(event.target.value)}
          placeholder="If you have one"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono uppercase"
        />
        <p className="text-xs text-muted-foreground">
          {/* Said here because the server ignores an unknown code rather than
              refusing the claim, so the invoice is the first and only place a
              wrong one shows up */}
          The invoice shows what you actually pay — check it before paying.
        </p>
      </div>

      <Button
        onClick={async () => {
          try {
            const result = await claim({ localPart, years, promoCode });
            // A free name comes back with no invoice — it is already reserved,
            // and a payment screen for nothing would strand the person
            if (result.bolt11) setPending(result);
          } catch {
            // The mutation has already said what went wrong
          }
        }}
        disabled={!available || isClaiming}
        className="w-full"
        size="lg"
      >
        {isClaiming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Reserve {localPart ? formatNip5(localPart, domain) : 'this name'}
      </Button>
    </div>
  );
}

function Availability({
  localPart,
  problem,
  isSearching,
  status,
  error,
  years,
  touched = false,
}: {
  localPart: string;
  problem: string;
  isSearching: boolean;
  status: ReturnType<typeof useNip5Search>['data'];
  error: Error | null;
  years: number;
  touched?: boolean;
}) {
  if (!localPart || !touched) return null;
  if (problem) return <p className="text-xs text-destructive flex items-center gap-1"><span>⚠</span>{problem}</p>;

  if (isSearching) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Search className="h-3 w-3 animate-spin" />
        Checking availability…
      </p>
    );
  }

  if (error) return <p className="text-xs text-destructive">{error.message}</p>;
  if (!status) return null;

  if (!status.available) {
    return <p className="text-xs text-destructive">Already taken.</p>;
  }

  return (
    <p className="text-xs text-success flex items-center gap-1">
      <Check className="h-3 w-3" />
      Available — {describePrice(status, years)}
      {status.price_reason ? ` (${status.price_reason})` : ''}
    </p>
  );
}

function PendingPayment({
  pending,
  quoted,
  onPay,
  isPaying,
  onCancel,
}: {
  pending: PendingNip5;
  /** The list price, so a discount can be shown as a difference. */
  quoted?: Nip5AddressStatus | null;
  onPay: (optionId?: string) => void;
  isPaying: boolean;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const { payOptions } = useNip5();

  const sats = pending.address?.extra?.price_in_sats;
  const promo = promoOutcome(quoted, pending.address?.extra);
  const usable = payOptions.filter((option) => !option.unavailable);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200/50 bg-blue-50/50 p-4 dark:border-blue-900/30 dark:bg-blue-950/20">
        <p className="font-medium text-sm">
          {pending.address?.local_part
            ? `${formatNip5(pending.address.local_part)} is reserved`
            : 'Your name is reserved'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          It goes live once {sats ? `${sats.toLocaleString()} sats are` : 'the invoice is'}{' '}
          paid. Nobody else can take it meanwhile.
        </p>
      </div>

      {/*
        Shown as a difference rather than as "code accepted", because the
        server ignores a code it does not know instead of refusing the claim —
        so the only proof a code did anything is that the price moved.
      */}
      {promo.applied && (
        <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success-strong">
          <Check className="h-4 w-4 shrink-0" />
          Discount applied
          {promo.savedSats
            ? ` — ${promo.savedSats.toLocaleString()} sats off`
            : ''}
        </p>
      )}

      {/* The QR was missing, and it is the only way to pay from a phone that
          is not this browser — which is where most people keep their sats */}
      <QrCode
        value={`lightning:${pending.bolt11}`}
        label="QR code for the invoice"
        size={192}
      />

      <div className="flex flex-col gap-2">
        {/* One button per wallet rather than one button that insists on ours.
            The custodial wallet here is empty for most people at the moment
            they first want to buy something, so a single "Pay now" wired to it
            failed for the most common case. */}
        {usable.map((option) => (
          <Button
            key={option.id}
            onClick={() => onPay(option.id)}
            disabled={isPaying}
            size="lg"
            className="w-full justify-between"
            variant={option.id === usable[0]?.id ? 'default' : 'outline'}
          >
            <span className="flex items-center gap-2">
              {isPaying && <Loader2 className="h-4 w-4 animate-spin" />}
              Pay with {option.label}
            </span>
            {option.detail && (
              <span className="text-xs opacity-80">{option.detail}</span>
            )}
          </Button>
        ))}

        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(pending.bolt11);
            toast({ title: 'Invoice copied' });
          }}
          className="w-full"
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy invoice
        </Button>

        <Button variant="outline" asChild className="w-full">
          <a href={`lightning:${pending.bolt11}`}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            Open in another wallet
          </a>
        </Button>

        <Button variant="ghost" onClick={onCancel} className="w-full">
          Back
        </Button>
      </div>

      <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/50 p-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Waiting for payment — however you pay it
        </p>
      </div>
    </div>
  );
}
