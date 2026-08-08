import { useState } from 'react';
import {
  BadgeCheck,
  Check,
  Clock,
  Copy,
  Loader2,
  Search,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useToast } from '@/hooks/useToast';
import {
  DEFAULT_MAX_YEARS,
  daysUntilExpiry,
  describeLocalPartProblem,
  describePrice,
  formatNip5,
  nip5State,
  normalizeLocalPart,
  validateLocalPart,
  yearOptions,
  type Nip5Address,
} from '@/lib/nip5';

/**
 * Buying and managing a verified name.
 *
 * Sits next to the lightning address card and deliberately says how it differs:
 * people arrive expecting `name@domain` to be one thing, and it is two — a free
 * permanent address that receives money, and a name bought by the year that
 * puts a ✓ next to their posts.
 *
 * Renders nothing when the operator hasn't set the extension up. An empty
 * section is better than one advertising a name we cannot sell.
 */
export function Nip5Card() {
  const nip5 = useNip5();

  if (!nip5.isConfigured || nip5.isUnavailable) return null;

  if (nip5.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BadgeCheck className="h-4 w-4" />
          Verified name
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {nip5.address ? <OwnedName /> : <BuyName />}
      </CardContent>
    </Card>
  );
}

function OwnedName() {
  const {
    address,
    identifier,
    isOnProfile,
    profileIdentifier,
    matchesCurrentKey,
    publishToProfile,
    isPublishing,
    attachLightning,
    isAttaching,
  } = useNip5();
  const { toast } = useToast();

  if (!address || !identifier) return null;

  const zappable = !!address.extra?.ln_address?.wallet;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border p-3">
        <span className="min-w-0 flex-1 truncate font-medium">{identifier}</span>
        <ExpiryBadge address={address} />
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(identifier);
            toast({ title: 'Name copied' });
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>

      {!matchesCurrentKey && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          This name verifies a different Nostr key than the one you're signed in
          with, so it won't put a ✓ on your posts here.
        </p>
      )}

      {isOnProfile ? (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" />
          Published to your profile — clients show the ✓ next to your name.
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm">
            {profileIdentifier
              ? `Your profile still says ${profileIdentifier}.`
              : "Your profile doesn't claim this name yet, so nobody sees the ✓."}
          </p>
          <Button
            size="sm"
            onClick={() => void publishToProfile().catch(() => {})}
            disabled={isPublishing}
          >
            {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish to my profile
          </Button>
        </div>
      )}

      {!zappable && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <p className="text-sm text-muted-foreground">
            Take zaps at this name too, not only verify with it.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void attachLightning(address).catch(() => {})}
            disabled={isAttaching}
          >
            {isAttaching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-2 h-4 w-4" />
            )}
            Enable zaps
          </Button>
        </div>
      )}
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
  const [pending, setPending] = useState<PendingNip5 | null>(null);

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
        // The mutations report their own failures; these catches only stop
        // an unhandled rejection reaching the console
        onPay={() => void pay(pending).catch(() => {})}
        isPaying={isPaying}
        onCancel={() => setPending(null)}
      />
    );
  }

  const options = yearOptions(DEFAULT_MAX_YEARS);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        A name that verifies you on Nostr — clients show a ✓ beside it. Rented
        by the year, unlike your lightning address, which is free and yours for
        good.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="nip5-name" className="text-xs">
          Your name
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="nip5-name"
            value={localPart}
            onChange={(event) =>
              setLocalPart(normalizeLocalPart(event.target.value))
            }
            placeholder="satoshi"
            aria-invalid={!!localPart && !!problem}
            className="max-w-[12rem]"
          />
          <span className="truncate text-sm text-muted-foreground">
            @{domain}
          </span>

          {options.length > 1 && (
            <Select
              value={String(years)}
              onValueChange={(value) => setYears(Number(value))}
            >
              <SelectTrigger className="w-28 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} {option === 1 ? 'year' : 'years'}
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
        />
      </div>

      <Button
        onClick={async () => {
          try {
            const result = await claim({ localPart, years });
            // A free name comes back with no invoice — it is already reserved,
            // and a payment screen for nothing would strand the person
            if (result.bolt11) setPending(result);
          } catch {
            // The mutation has already said what went wrong
          }
        }}
        disabled={!available || isClaiming}
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
}: {
  localPart: string;
  problem: string;
  isSearching: boolean;
  status: ReturnType<typeof useNip5Search>['data'];
  error: Error | null;
  years: number;
}) {
  if (!localPart) return null;
  if (problem) return <p className="text-xs text-destructive">{problem}</p>;

  if (isSearching) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Search className="h-3 w-3" />
        Checking…
      </p>
    );
  }

  if (error) return <p className="text-xs text-destructive">{error.message}</p>;
  if (!status) return null;

  if (!status.available) {
    return <p className="text-xs text-destructive">That one is taken.</p>;
  }

  return (
    <p className="text-xs text-muted-foreground">
      Available — {describePrice(status, years)}
      {status.price_reason ? ` (${status.price_reason})` : ''}
    </p>
  );
}

function PendingPayment({
  pending,
  onPay,
  isPaying,
  onCancel,
}: {
  pending: PendingNip5;
  onPay: () => void;
  isPaying: boolean;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const sats = pending.address?.extra?.price_in_sats;

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {pending.address?.local_part
          ? `${pending.address.local_part} is held for you.`
          : 'Your name is held for you.'}{' '}
        It goes live once the invoice is paid.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onPay} disabled={isPaying}>
          {isPaying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Pay {sats ? `${sats.toLocaleString()} sats ` : ''}from my wallet
        </Button>

        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(pending.bolt11);
            toast({ title: 'Invoice copied' });
          }}
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy invoice
        </Button>

        <Button variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Waiting for the payment to settle…
      </p>
    </div>
  );
}
