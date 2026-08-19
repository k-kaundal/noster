import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
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
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLightningAddress } from '@/hooks/useLightningAddress';
import { useLnbitsPayments } from '@/hooks/useLnbitsWallet';
import { useToast } from '@/hooks/useToast';
import { servesAddress } from '@/lib/identity';
import { ADDRESS_DOMAINS } from '@/lib/lightningAddress';
import { cn } from '@/lib/utils';
import {
  DEFAULT_MAX_YEARS,
  daysUntilExpiry,
  describeLocalPartProblem,
  describePrice,
  formatNip5,
  expiresAt,
  findNamePayment,
  nip5Host,
  nip5Identifier,
  nip5State,
  isLnAddressPending,
  isZappable,
  lnAddressConfig,
  attachedWalletIsForeign,
  defaultAttachWallet,
  normalizeLocalPart,
  outstandingPaymentHash,
  formatAmount,
  priceBreakdown,
  validateLocalPart,
  yearOptions,
  type Nip5Address,
  type Nip5AddressStatus,
  type Nip5Domain,
  type PriceBreakdown,
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
        <h3 className="text-sm font-semibold">
          {nip5.addresses.length > 1 ? 'Verified names' : 'Verified name'}
        </h3>
      </div>

      {nip5.addresses.length ? <OwnedNames /> : <BuyName />}
    </div>
  );
}

/**
 * Every name somebody holds, and the offer to buy another.
 *
 * This showed one name and then hid the shop, which made the first purchase
 * the last one: an account can hold as many names as it pays for, on any of
 * the domains on offer, and there was no way to reach a second. Names are also
 * not interchangeable — each has its own expiry, its own wallet, and only one
 * of them can be the one that verifies the key — so they are listed rather
 * than summarised.
 */
function OwnedNames() {
  const { addresses } = useNip5();
  const [buying, setBuying] = useState(false);

  const done = useCallback(() => setBuying(false), []);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {addresses.map((address) => (
          <OwnedName key={address.id} address={address} />
        ))}
      </div>

      {buying ? (
        <div className="space-y-3 rounded-xl border border-dashed p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Another name</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setBuying(false)}
            >
              Cancel
            </Button>
          </div>
          {/* No pitch: they have already bought one, so explaining what a
              verified name is reads as not knowing who they are */}
          <BuyName pitch={false} onBought={done} />
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setBuying(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Buy another name
        </Button>
      )}
    </div>
  );
}

function OwnedName({ address }: { address: Nip5Address }) {
  const { user } = useCurrentUser();
  const { profileIdentifier, publishToProfile, isPublishing } = useNip5();
  const { toast } = useToast();

  const identifier = nip5Identifier(address);
  if (!identifier) return null;

  const zappable = isZappable(address);
  const matchesCurrentKey = !user || address.pubkey === user.pubkey;
  // Compared case-insensitively: a profile written by another client can carry
  // the same name in a different case, and it verifies just the same
  const onProfile =
    profileIdentifier?.trim().toLowerCase() === identifier.toLowerCase();

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center gap-3">
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

      {/*
        Which one of them wears the ✓. A profile holds a single `nip05`, so
        holding three names is holding three names and choosing one — and
        without this the choice belongs to whichever the extension listed
        first, which is not a choice anybody made.
      */}
      {matchesCurrentKey &&
        nip5State(address) !== 'inactive' &&
        (onProfile ? (
          <p className="flex items-center gap-1.5 text-xs text-success-strong">
            <Check className="h-3.5 w-3.5" />
            This is the name on your profile.
          </p>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={isPublishing}
            onClick={() => void publishToProfile(address).catch(() => {})}
          >
            {isPublishing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Use this one for my ✓
          </Button>
        ))}

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

      <ZapsHere address={address} identifier={identifier} />
    </div>
  );
}

/**
 * Pointing the profile's zap address at this name.
 *
 * The card could say "kk@getzap.me receives payments" and offer no way to tell
 * anyone: `nip05` and `lud16` are two separate profile fields, and publishing
 * the name as one of them says nothing about the other. So a name could be
 * verified, attached to a wallet, and still not be where zaps went — with
 * nothing on screen to fix it.
 *
 * The list of addresses further up cannot cover this. It reads pay links, and
 * the link the extension makes for a name carries no domain, so it shows up
 * there under the *lightning* domain rather than the one the name is actually
 * bought at — a different address, and not the one to publish.
 */
function ZapsHere({
  address,
  identifier,
}: {
  address: Nip5Address;
  identifier: string;
}) {
  const { addresses, profileAddress, setProfileAddress, isPublishing } =
    useLightningAddress();

  /*
   * Nothing to publish until payments actually land somewhere — but "somewhere"
   * includes a pay link of theirs answering for this address, which the name's
   * own record knows nothing about. Reading only the record hid this button
   * from exactly the people whose profile was still pointed at an older
   * address, which is the case it exists for.
   */
  const payable = isZappable(address) || servesAddress(addresses, identifier, ADDRESS_DOMAINS);
  if (!payable || nip5State(address) === 'inactive') return null;

  if (profileAddress?.trim().toLowerCase() === identifier.toLowerCase()) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-success-strong">
        <Check className="h-3.5 w-3.5" />
        Zaps land here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {profileAddress
          ? `Your profile still sends zaps to ${profileAddress}.`
          : 'Your profile does not advertise a zap address yet.'}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={isPublishing}
        onClick={() => void setProfileAddress(identifier).catch(() => {})}
      >
        {isPublishing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Send my zaps here
      </Button>
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

  /**
   * What the account can already be paid at.
   *
   * The name's own record is not the whole picture: a pay link made through
   * the plain lightning flow answers for the same address without the NIP-05
   * extension ever noting it, and reading only the extension's note is what
   * produced "nothing sent to it arrives" about an address that arrives fine.
   */
  const { addresses: payable } = useLightningAddress();

  const current = lnAddressConfig(address);
  const alreadyServed = servesAddress(payable, identifier, ADDRESS_DOMAINS);
  const pending = isLnAddressPending(address);

  /**
   * Only what somebody picked, so the default can still move under it.
   *
   * Initialising state from the wallet list would freeze whatever was there on
   * the first render — which is nothing, because the wallets arrive from a
   * query — leaving the form permanently pointed at an empty id.
   */
  const [picked, setPicked] = useState<string | null>(null);

  const walletIds = wallets.map((entry) => entry.id);

  /**
   * Never the stored wallet when it belongs to another account.
   *
   * Defaulting to it is how a foreign id got sent back on every retry — the
   * server raises looking it up and answers a bare 500, so the repair button
   * failed identically however many times it was pressed.
   */
  const foreign = attachedWalletIsForeign(address, walletIds);
  const walletId = picked ?? defaultAttachWallet(address, walletIds);

  /**
   * Nothing about receiving, until the name exists.
   *
   * A name whose invoice has not settled cannot have a pay link — the
   * extension will not build one for a name it has not activated — so the
   * missing link is the expected state, not a fault. Reporting it as one put
   * "the payment link behind the name was never created … nothing sent to it
   * arrives" under a name whose only real problem is that it is unpaid, and
   * offered a repair button that cannot work yet. The card above already says
   * the true thing and offers the invoice.
   */
  if (nip5State(address) === 'inactive') return null;

  const named = wallets.find((entry) => entry.id === current?.wallet);
  const changed = !!current && walletId !== current.wallet;

  /*
   * No wallet, said rather than hidden. This returned null, so somebody who
   * bought a name before making a wallet saw nothing at all about being paid
   * at it — no explanation, and no clue that a wallet is what it waits on.
   * Nothing is offered here because there is nothing to press: every button
   * this component has writes into a wallet by id.
   */
  if (!wallets.length) {
    return (
      <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
        {identifier} verifies you, and needs a wallet before it can be paid.
        Set one up above and it can receive zaps under the same name.
      </p>
    );
  }

  const submit = () =>
    void attachLightning({ address, walletId }).catch(() => {});

  /*
   * Half-finished, but the address works anyway.
   *
   * The extension never recorded its pay link, while a link of theirs already
   * answers for this exact address — so money arrives and the only thing wrong
   * is the bookkeeping. Worth offering to repair, because the extension needs
   * that field to serve the name after the plain link is ever retired; not
   * worth alarming anybody over, which the warning below would.
   */
  if (pending && alreadyServed) {
    return (
      <div className="space-y-2 rounded-lg border p-3">
        <p className="flex items-center gap-2 text-sm text-success-strong">
          <Zap className="h-4 w-4 shrink-0" />
          {identifier} receives payments.
        </p>
        <p className="text-xs text-muted-foreground">
          It is answered by your own pay link rather than by the name's own
          record. Nothing needs doing — the two resolve to the same place, and
          the extension cannot adopt an existing link: asking it to tries to
          create a second one under the same name, which is refused.
        </p>
      </div>
    );
  }

  /*
   * Pointed at a wallet this account cannot reach.
   *
   * The id on the address outlives the account that owned it, so a name
   * attached under one LNbits login keeps naming that login's wallet after
   * signing in as another. Every retry sent the same dead id and collected the
   * same empty 500, which is why "Finish setting it up" looked like a button
   * that does nothing. Pointing it at a real wallet is the fix, and that is a
   * choice, so it drops through to the form below rather than offering a
   * repair that would repeat the failure.
   */
  if (foreign) {
    return (
      <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/8 p-3">
        <p className="text-sm font-medium text-warning-strong">
          {identifier} pays into a wallet this account no longer has.
        </p>
        <p className="text-xs text-muted-foreground">
          It was attached while signed in to a different LNbits account, so
          nothing sent to it can arrive here. Choose one of your wallets and it
          starts receiving again.
        </p>

        <Select value={walletId} onValueChange={setPicked}>
          <SelectTrigger className="bg-background">
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

        <Button
          size="sm"
          onClick={submit}
          disabled={isAttaching || !walletId}
          className="w-full"
        >
          {isAttaching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Point it at this wallet
        </Button>
      </div>
    );
  }

  /*
   * Asked for and not finished. Saying "receives payments" here is the thing
   * that sent somebody hunting for zaps that were never going to arrive — the
   * wallet was stored, the pay link behind it was not made, and the address
   * resolves to nothing payable. Retrying is the same call that created it.
   */
  if (pending) {
    return (
      <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/8 p-3">
        <p className="text-sm font-medium text-warning-strong">
          {identifier} isn't set up to receive yet.
        </p>
        <p className="text-xs text-muted-foreground">
          {named
            ? `${named.name} was chosen for it, but the payment link behind the name was never created`
            : 'A wallet was chosen for it, but the payment link behind the name was never created'}{' '}
          — and nothing else of yours answers for this address either, so
          nothing sent to it arrives.
        </p>
        <Button
          size="sm"
          onClick={submit}
          disabled={isAttaching}
          className="w-full"
        >
          {isAttaching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Finish setting it up
        </Button>
      </div>
    );
  }

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
    <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/[0.06] p-4">
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
            htmlFor={`nip5-wallet-${address.id}`}
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Pays into
          </Label>
          <Select value={walletId} onValueChange={setPicked}>
            <SelectTrigger
              id={`nip5-wallet-${address.id}`}
              className="bg-background"
            >
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

  /*
   * Their own ledger, as the second way of asking. Shares the query the
   * wallet screen already runs, so it costs nothing here.
   */
  const ledger = useLnbitsPayments();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['nip5-addresses'] }),
      ledger.refetch(),
    ]);

  /**
   * The invoice from this session if there is one, otherwise the one the
   * address itself remembers.
   *
   * That fallback is what makes a payment made anywhere else land here: from a
   * phone, from another browser, or from a wallet opened after this page was
   * reloaded. Watching only the session's own claim meant an invoice could
   * settle with nothing looking, and the name sat at "awaiting payment"
   * offering to sell itself again.
   */
  const watched = pending?.paymentHash ?? outstandingPaymentHash(address);
  const paid = useNip5Payment(watched, pending?.domainId ?? address.domain_id);

  /**
   * Money that already left for this name.
   *
   * Two sources because either can be blind. The extension's payment route
   * answers for any wallet but refuses outright when the invoice's metadata
   * did not survive — a 400 that reads as "not paid" and never changes. The
   * ledger only sees payments made from the wallet in this app, but it sees
   * them for good, and it is the one that can answer about a payment made
   * before this page was ever opened.
   */
  const settledInvoice = paid.data === true;
  const spent = findNamePayment(nip5Identifier(address), ledger.data);
  const receipt = spent?.payment_hash ?? watched;

  if (nip5State(address) !== 'inactive') return null;

  if (pending && !paid.data) {
    return (
      <PendingPayment
        pending={pending}
        // The code the reservation was made with, so the invoice still
        // accounts for itself on a visit days after the code was typed
        promoCode={address.extra?.promo_code}
        onPay={(optionId) => void pay({ pending, optionId }).catch(() => {})}
        isPaying={isPaying}
        onCancel={() => setPending(null)}
      />
    );
  }

  const years = address.extra?.years ?? 1;
  const sats = address.extra?.price_in_sats;

  /*
   * What the code on this reservation is actually worth, days after it was
   * typed. The extension recomputes its verdict on every read and stores only
   * the discounted price, so this is the one place the discount can still be
   * accounted for — and the place somebody comes back to in order to pay.
   */
  const price = priceBreakdown(
    null,
    address.extra,
    address.extra?.promo_code,
    address.promo_code_status
  );

  /*
   * Paid for, and still not live. Said instead of the panel below, because
   * that one asks for the money again — which is the wrong thing to put in
   * front of somebody who has already sent it, and the expensive kind of
   * wrong.
   */
  if (spent || settledInvoice) {
    return (
      <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/8 p-4">
        <p className="text-sm font-medium text-warning-strong">
          {nip5Identifier(address)} is paid for and hasn't been switched on.
        </p>
        <p className="text-xs text-muted-foreground">
          {spent
            ? `${formatAmount(Math.round(Math.abs(spent.amount) / 1000), 'sats')} left your wallet for this name. `
            : 'The invoice for this name settled. '}
          The name goes live when {nip5Host(address.domain_id)} registers the
          payment, and that hasn't happened — so it is waiting on the domain,
          not on you.{' '}
          <span className="font-medium">Don't pay again</span>; a second
          invoice would be a second charge for the same name.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => void refresh()}
          >
            Check again
          </Button>

          {/*
            The payment's own id, because this is where somebody has to go
            asking. Whoever runs the domain can only find this payment by its
            hash — it is not in their sales list, precisely because the sale
            never completed — and without it the report is "I paid and nothing
            happened", which nobody can act on.
          */}
          {receipt && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(receipt);
                toast({ title: 'Payment reference copied' });
              }}
            >
              <Copy className="mr-2 h-3.5 w-3.5" />
              Reference
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/8 p-4">
      <p className="text-sm text-warning-strong">
        {nip5Identifier(address)} is reserved for you and not live yet.
        {sats ? ` It costs ${sats.toLocaleString()} sats.` : ''} Nobody else can
        take it in the meantime.
      </p>

      {price.promo !== 'none' && (
        <div className="rounded-lg bg-background/60">
          <PriceSummary price={price} />
        </div>
      )}

      <Button
        size="sm"
        className="w-full"
        disabled={isClaiming}
        onClick={() =>
          void claim({
            localPart: address.local_part,
            years,
            // The domain it was reserved under, not the default one — asking
            // the wrong domain reserves a second name somewhere else
            domainId: address.domain_id,
            /*
             * And the code it was reserved with. Paying later goes back
             * through the claim endpoint to raise the invoice, so leaving the
             * code out here would quietly re-price the name at full rate for
             * anybody who did not pay in the same sitting.
             */
            promoCode: address.extra?.promo_code,
          })
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
  /*
   * Nothing for a name nobody has paid for. `expires_at` is written when the
   * address record is *created*, not when it is activated, so an unpaid
   * reservation carries a date a year out — and the card read "Rented until
   * 20/08/2027" directly above "Awaiting payment", which is the reservation
   * claiming to be the thing it is waiting to become.
   */
  if (!address.active) return null;

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
          ? `${nip5Identifier(address)} has expired.`
          : `${nip5Identifier(address)} runs out in ${days} ${
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

function BuyName({
  pitch = true,
  onBought,
}: {
  pitch?: boolean;
  /** Called once the name is live, so a caller showing this can put it away. */
  onBought?: () => void;
}) {
  const { domains, claim, isClaiming, pay, isPaying, suggestedFrom } = useNip5();

  const [localPart, setLocalPart] = useState(() =>
    normalizeLocalPart(suggestedFrom)
  );
  const [years, setYears] = useState(1);
  const [promoCode, setPromoCode] = useState('');
  const [pending, setPending] = useState<PendingNip5 | null>(null);
  /**
   * Which domain to buy under.
   *
   * A name is the pair, not the local part: `alice` on one domain and `alice`
   * on another are two different names, priced separately, and either can be
   * taken while the other is free.
   */
  const [domainId, setDomainId] = useState(() => domains[0]?.id ?? '');
  // Availability stays hidden until the field is used, so a prefilled
  // suggestion doesn't greet you with a validation error
  const [touched, setTouched] = useState(false);

  const featured = domains[0];
  const domain = nip5Host(domainId);

  const search = useNip5Search(localPart, years, domainId);
  const paid = useNip5Payment(pending?.paymentHash, pending?.domainId);

  // The name appears in the list above the moment it settles, so leaving the
  // form open underneath it invites somebody to buy the same thing twice
  const settled = paid.data === true;
  useEffect(() => {
    if (!settled) return;
    setPending(null);
    onBought?.();
  }, [settled, onBought]);

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
        // And what was typed, so a code the server silently dropped can be
        // reported as dropped rather than passed over
        promoCode={promoCode}
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
      {pitch && (
        <div className="rounded-lg bg-gradient-to-br from-success/8 to-success/5 p-3 dark:from-success/10 dark:to-success/5">
          <p className="text-sm text-foreground">
            {/* Named, because "a verified name" is an abstraction and
                `you@getzap.me` is the thing somebody actually wants */}
            A verified name at{' '}
            <span className="font-medium">{featured?.domain}</span> shows a{' '}
            <span className="inline font-mono">✓</span> on your posts. Rented by
            the year.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <Label htmlFor="nip5-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your name
        </Label>
        <div className="flex flex-wrap items-center gap-2">
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

        {domains.length > 1 && (
          <DomainChoice
            domains={domains}
            value={domainId}
            onChange={setDomainId}
            localPart={localPart}
            years={years}
          />
        )}
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
        {/*
          Typed through unchanged.

          It used to be uppercased on the way out, by CSS here and by
          `normalizePromoCode` on the way to the server. The extension compares
          codes exactly — no folding of any kind — so a code the operator wrote
          as `spring24` could not be redeemed by anybody, and the field showed
          capitals that were not what would be sent. `autoCapitalize` did the
          same thing again on a phone.
        */}
        <Input
          id="nip5-promo"
          value={promoCode}
          onChange={(event) => setPromoCode(event.target.value)}
          placeholder="If you have one"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="font-mono"
        />
        {/*
          Says where the answer comes from, rather than leaving somebody to
          wonder why the price above did not move as they typed.

          It cannot move here. The extension's search endpoint takes a name and
          a year count and nothing else, and the promotions live on the domain
          record, which is readable only with the operator's API key — so the
          code is genuinely unchecked until the reservation is made. The old
          copy said it would be "applied", which promised an outcome; this says
          what happens, including that reserving costs nothing.
        */}
        <p className="text-xs text-muted-foreground">
          {promoCode.trim()
            ? 'Checked against the domain when you reserve, which costs nothing — the next screen shows what it took off, or that it was not recognised, before you pay.'
            : 'The invoice shows what you actually pay — check it before paying.'}
        </p>
      </div>

      {/*
        The total, before the button that commits to it.

        Reserving raises a real invoice, and doing that to find out the price
        is the wrong order. `describePrice` is per-domain and lives up beside
        the name; this is the sum for the years chosen, which is the number
        the invoice will match.
      */}
      {available && search.data && (
        <div className="space-y-1 rounded-lg border px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              {years > 1 ? `${years} years` : '1 year'} at {domain}
            </span>
            <span className="font-medium tabular-nums">
              {search.data.price_in_sats
                ? formatAmount(search.data.price_in_sats, 'sats')
                : 'Free'}
            </span>
          </div>

          {/*
            Labels the figure rather than leaving it to be read as the total.
            With a code in the box this number is the one thing on screen that
            the code has not been applied to, and shown bare it reads as the
            answer — which is what "I entered a code and nothing checked it"
            looks like from here.
          */}
          {!!promoCode.trim() && !!search.data.price_in_sats && (
            <p className="text-xs text-muted-foreground">
              Before{' '}
              <span className="font-mono">{promoCode.trim()}</span> — reserving
              is what prices it.
            </p>
          )}
        </div>
      )}

      <Button
        onClick={async () => {
          try {
            const result = await claim({
              localPart,
              years,
              domainId,
              promoCode,
            });
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

/**
 * Which domain to buy the name at.
 *
 * A dropdown was the wrong control for this. It hides every option but one
 * behind a click, which is fine for a setting and wrong for the decision that
 * changes both what the name reads as and what it costs — the same local part
 * is priced separately per domain and can be free on one and taken on another.
 * Laid out, each option answers "can I have it, and for how much" without
 * being opened.
 *
 * The first configured domain leads and is marked. Somebody with no opinion
 * takes the recommendation, which is the operator's to make: it is their best
 * domain, the one worth putting in front of people, and the order in the
 * config is how they say so.
 */
function DomainChoice({
  domains,
  value,
  onChange,
  localPart,
  years,
}: {
  domains: Nip5Domain[];
  value: string;
  onChange: (id: string) => void;
  localPart: string;
  years: number;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Domain
      </Label>

      <div className="grid gap-2">
        {domains.map((entry, index) => (
          <DomainOption
            key={entry.id}
            domain={entry}
            featured={index === 0}
            selected={entry.id === value}
            onSelect={() => onChange(entry.id)}
            localPart={localPart}
            years={years}
          />
        ))}
      </div>
    </div>
  );
}

function DomainOption({
  domain,
  featured,
  selected,
  onSelect,
  localPart,
  years,
}: {
  domain: Nip5Domain;
  featured: boolean;
  selected: boolean;
  onSelect: () => void;
  localPart: string;
  years: number;
}) {
  /*
   * Its own search, so each option can price itself. Cheap: the query is
   * debounced and keyed per domain, so a row that nobody is typing at holds
   * its answer instead of asking again.
   */
  const status = useNip5Search(localPart, years, domain.id).data;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5'
          : 'hover:border-primary/40 hover:bg-muted/40',
        featured && !selected && 'border-primary/30'
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {localPart ? `${localPart}@${domain.domain}` : `@${domain.domain}`}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {!status
            ? 'Type a name to see the price'
            : status.available
              ? describePrice(status, years)
              : 'Taken here'}
        </p>
      </div>

      {featured && (
        <Badge variant="secondary" className="shrink-0">
          Recommended
        </Badge>
      )}
      {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </button>
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

/**
 * The sum behind the invoice: list price, what the code took off, what is owed.
 *
 * A single number is not enough here, and "Discount applied" on its own is
 * worse than nothing — it is a claim somebody cannot check. Laid out as a sum,
 * the three lines answer the only questions there are: what it normally costs,
 * what my code was worth, what I am about to pay.
 *
 * The unhappy case is the reason this exists. The extension does not refuse a
 * code it has never heard of; it drops it and raises a full-price invoice. So
 * a mistyped or expired code produced a screen that said nothing at all, and
 * somebody who believed they had 20% off paid 100% without a word.
 */
function PriceSummary({
  price,
  onRemoveCode,
}: {
  price: PriceBreakdown;
  /**
   * Back to the form, which is where a code can be changed or dropped.
   *
   * Absent where there is no form to go back to — a reservation from a
   * previous visit is priced and stored, and the extension re-prices it from
   * the code it remembers, so offering to change it would be offering
   * something that does not happen.
   */
  onRemoveCode?: () => void;
}) {
  /*
   * Nothing to account for. With no code in play the amount owed is the whole
   * story, and the panel above has already said it — a sum with one line in it
   * is the same number twice.
   */
  if (price.promo === 'none') return null;

  const { list, saved, paid, unit } = price;
  const discounted = saved !== undefined && list !== undefined;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      {discounted && (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted-foreground">List price</span>
          <span className="tabular-nums text-muted-foreground line-through decoration-muted-foreground/60">
            {formatAmount(list, unit)}
          </span>
        </div>
      )}

      {/*
        The line for a code that worked. Shown whenever the server says the
        code is worth something, even with no amount to put beside it: a
        reservation reopened tomorrow has no quote to subtract from, and
        "20% off" with no figure still beats saying nothing at all.
      */}
      {price.promo === 'applied' && (
        <div className="flex items-baseline justify-between gap-3 text-sm text-success-strong">
          <span className="flex min-w-0 items-center gap-1.5">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-mono text-xs">{price.code}</span>
            {/* The form a promotion is usually quoted in, next to the form it
                is actually paid in */}
            {!!price.savedPercent && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {price.savedPercent}% off
              </span>
            )}
          </span>
          {saved !== undefined && (
            <span className="shrink-0 tabular-nums">
              −{formatAmount(saved, unit)}
            </span>
          )}
        </div>
      )}

      {paid !== undefined && (
        <div
          className={cn(
            'flex items-baseline justify-between gap-3 text-sm font-medium',
            // A rule under nothing is just a line across a box
            discounted && 'border-t pt-2'
          )}
        >
          <span>You pay</span>
          <span className="tabular-nums">
            {paid > 0 ? formatAmount(paid, unit) : 'Free'}
          </span>
        </div>
      )}

      {/*
        Said plainly, and with the way out attached. The alternative is silence
        on the one screen where the code's failure is still fixable — the name
        is reserved either way, and going back to drop the code costs nothing.
      */}
      {price.promo === 'ignored' && (
        <p className="flex items-start gap-2 rounded-md bg-warning/10 p-2.5 text-xs text-warning-strong">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-mono">{price.code}</span>{' '}
            {price.checked
              ? /*
                 * The server was asked and said nothing matches. Worth saying
                 * as plainly as that, including the part people get wrong —
                 * these are compared exactly, so the same code in the wrong
                 * case is a different code.
                 */
                'is not a code this domain knows. Check the spelling and the capitals — they have to match exactly. The reservation went through at full price.'
              : "didn't change the price — it may have expired, or never existed. The reservation went through at full price either way."}{' '}
            {onRemoveCode && (
              <>
                <button
                  type="button"
                  onClick={onRemoveCode}
                  className="underline underline-offset-2"
                >
                  Go back
                </button>{' '}
                to try a different one.
              </>
            )}
          </span>
        </p>
      )}

      {/*
        Ignorance, said as ignorance. Without a quote to compare against, the
        code may well have worked — and "it didn't work" would be a guess
        presented as a finding.
      */}
      {price.promo === 'unknown' && (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{price.code}</span> was sent with the
          reservation. The amount above is what the invoice asks for, discount
          included.
        </p>
      )}
    </div>
  );
}

function PendingPayment({
  pending,
  quoted,
  promoCode,
  onPay,
  isPaying,
  onCancel,
}: {
  pending: PendingNip5;
  /** The list price, so a discount can be shown as a difference. */
  quoted?: Nip5AddressStatus | null;
  /** What was typed into the code field, so its silence can be reported. */
  promoCode?: string;
  onPay: (optionId?: string) => void;
  isPaying: boolean;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const { payOptions } = useNip5();

  const sats = pending.address?.extra?.price_in_sats;
  const price = priceBreakdown(
    quoted,
    pending.address?.extra,
    promoCode,
    // The server's own verdict on the code, which comes back with the
    // reservation — the only thing here that is checked rather than read off
    // a pair of numbers
    pending.address?.promo_code_status
  );
  const usable = payOptions.filter((option) => !option.unavailable);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/25 bg-primary/[0.06] p-4">
        <p className="font-medium text-sm">
          {pending.address?.local_part
            ? `${nip5Identifier(pending.address)} is reserved`
            : 'Your name is reserved'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          It goes live once {sats ? `${sats.toLocaleString()} sats are` : 'the invoice is'}{' '}
          paid. Nobody else can take it meanwhile.
        </p>
      </div>

      <PriceSummary price={price} onRemoveCode={onCancel} />

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
