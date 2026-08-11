import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  Check,
  Loader2,
  Plug,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AddressReceiveDialog } from '@/components/wallet/AddressReceiveDialog';
import { useDebounce } from '@/hooks/useDebounce';
import { useIdentity } from '@/hooks/useIdentity';
import { useLaWallet } from '@/hooks/useLaWallet';
import { useNWC } from '@/hooks/useNWCContext';
import { useToast } from '@/hooks/useToast';
import {
  describeLaWalletNameProblem,
  describeMode,
  isLive,
  laWalletAddress,
  suggestLaWalletName,
  validateLaWalletName,
  type AddressMode,
  type HeldAddress,
} from '@/lib/lawallet';
import type { NamePrice } from '@/hooks/useLaWallet';

/**
 * An address that keeps its name while you change what is behind it.
 *
 * The other two kinds of address in this app are each welded to one wallet: an
 * LNbits pay link always pays its LNbits wallet, and an address held elsewhere
 * always pays whoever issued it. Moving between them means telling everyone a
 * new name — which for anyone who has published theirs on a profile, a site, a
 * business card, is the reason they do not move.
 *
 * This one has a destination you set. Point it at a wallet you connect over
 * NWC, or forward it to another address entirely, and change your mind later
 * without the name changing.
 */
export function PortableAddress() {
  const lawallet = useLaWallet();

  if (!lawallet.available) return null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your addresses at {lawallet.domain}
        </p>
        {/* A different service from the one above, with its own account and
            its own connected wallets. Both write an address the same way,
            which is exactly why each says whose it is. */}
        <p className="mt-1 text-xs text-muted-foreground">
          A separate service. These point wherever you tell them — at a wallet
          you connect, or on to another address — and the name stays the same
          when you change your mind.
        </p>
      </div>

      <HeldAddresses />

      <ConnectedWallets />

      {/* Only when they hold nothing here at all. Offering a claim form to
          somebody who already has an address — including one the directory
          found rather than their own account list — is how a person ends up
          with two names and their zaps arriving at the older one. */}
      {!lawallet.held.length && !lawallet.isLoading && <ClaimForm />}
    </div>
  );
}

/**
 * The wallets the service can spend from on this person's behalf.
 *
 * Each one is an NWC connection string held on someone else's server, and it
 * keeps working until it is revoked. There was no way to see them here, let
 * alone withdraw one — which is the wrong way round for a credential that
 * spends money.
 */
function ConnectedWallets() {
  const lawallet = useLaWallet();
  const [confirming, setConfirming] = useState<string | null>(null);

  const wallets = lawallet.wallets;
  if (!wallets.length) return null;

  // Which addresses stop receiving if a given wallet goes away
  const dependents = (id: string) =>
    lawallet.held.filter((entry) => entry.settings?.remoteWalletId === id);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Wallets this service can spend from
      </p>

      {wallets.map((wallet) => {
        const affected = dependents(wallet.id);

        return (
          <div key={wallet.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{wallet.name}</p>
              <p className="text-xs text-muted-foreground">
                {affected.length
                  ? `${affected.length} address${affected.length === 1 ? '' : 'es'} paid by this`
                  : 'Nothing points at it'}
                {wallet.isDefault && ' · default'}
              </p>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive"
              disabled={lawallet.isRevoking}
              onClick={() => setConfirming(wallet.id)}
            >
              Disconnect
            </Button>
          </div>
        );
      })}

      {confirming && (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs leading-relaxed">
            {/* Said before the click. The connection stops being able to spend,
                which is the point, and anything pointed at it stops receiving,
                which is not and would otherwise be discovered as silence. */}
            It stops being able to spend from your wallet.{' '}
            {dependents(confirming).length > 0 &&
              `${dependents(confirming).length} address${
                dependents(confirming).length === 1 ? '' : 'es'
              } paid by it stop receiving until you point them somewhere else. `}
            You can connect it again afterwards.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={lawallet.isRevoking}
              onClick={() => {
                void lawallet
                  .revokeWallet(confirming)
                  .catch(() => {})
                  .finally(() => setConfirming(null));
              }}
            >
              {lawallet.isRevoking && (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              )}
              Disconnect it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** How many to show before the rest go behind a button. */
const VISIBLE = 4;

/**
 * Everything they hold, without rendering all of it.
 *
 * People collect these — one account on the test instance holds seventy — and
 * each row is a full editor with its own queries. Rendering the lot cost that
 * many times over and buried the address their money actually arrives at
 * somewhere in the middle of a very long page. The primary one sorts first and
 * the tail waits behind a button.
 */
function HeldAddresses() {
  const lawallet = useLaWallet();
  const [expanded, setExpanded] = useState(false);

  const held = lawallet.held;
  const shown = expanded ? held : held.slice(0, VISIBLE);
  const hidden = held.length - shown.length;

  return (
    <>
      {shown.map((entry) =>
        entry.settings ? (
          <AddressRow key={entry.username} held={entry} />
        ) : (
          <LinkedAddress key={entry.username} held={entry} />
        )
      )}

      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={() => setExpanded(true)}
        >
          Show {hidden.toLocaleString()} more{' '}
          {hidden === 1 ? 'address' : 'addresses'}
        </Button>
      )}
    </>
  );
}

/**
 * An address the directory says is theirs, which their account does not list.
 *
 * Made under a different account on the same platform, most likely. It
 * resolves and it receives, so it is worth showing and worth publishing — but
 * nothing here knows where it points, and an editor whose every save fails is
 * worse than no editor.
 */
function LinkedAddress({ held }: { held: HeldAddress }) {
  const { lightning } = useIdentity();
  const { toast } = useToast();
  const [receiving, setReceiving] = useState(false);

  const address = held.address;
  const onProfile = lightning.profileAddress === address;

  return (
    <div className="flex items-center gap-2 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{address}</p>
        <p className="text-xs text-muted-foreground">
          {held.refusal ?? 'Already linked to your key. Manage where it points where you set it up.'}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!held.refusal && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setReceiving(true)}
          >
            <ArrowDownLeft className="mr-1 h-3 w-3" />
            Receive
          </Button>
        )}

        {onProfile ? (
          <Badge variant="secondary" className="gap-1 bg-success/15 text-success">
            <Zap className="h-3 w-3" />
            Zaps land here
          </Badge>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={lightning.isPublishing}
            onClick={() => {
              void lightning
                .setProfileAddress(address)
                .then(() => toast({ title: `Zaps now go to ${address}` }))
                .catch(() => {});
            }}
          >
            Use for zaps
          </Button>
        )}
      </div>

      <AddressReceiveDialog
        address={address}
        open={receiving}
        onOpenChange={setReceiving}
      />
    </div>
  );
}

function ClaimForm() {
  const { claim, isClaiming, buy, isBuying, checkName, domain } = useLaWallet();
  const { suggestion } = useIdentity();

  const [name, setName] = useState(() => suggestLaWalletName(suggestion));
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  /**
   * Set when the service answers "that one costs money".
   *
   * There is no price endpoint to ask beforehand — the charge only appears as
   * a refusal, and the figure only inside the invoice raised in response. So
   * the price arrives after the first press, and the second press is the one
   * that spends.
   */
  const [price, setPrice] = useState<NamePrice | null>(null);

  const problem = validateLaWalletName(name);
  const debounced = useDebounce(name, 500);

  /**
   * Availability is a public lookup, which is what lets it run while someone
   * types rather than only when they commit. In an effect rather than the
   * render pass: setting state while rendering is how a component ends up
   * re-rendering itself in a loop.
   */
  useEffect(() => {
    if (debounced !== name || validateLaWalletName(debounced)) return;

    let current = true;
    setChecking(true);

    checkName(debounced)
      .then((result) => current && setAvailable(result))
      // A failed lookup is not a taken name; leaving it null lets them try
      .catch(() => current && setAvailable(null))
      .finally(() => current && setChecking(false));

    return () => {
      current = false;
    };
  }, [debounced, name, checkName]);

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(event) => {
            setName(suggestLaWalletName(event.target.value));
            setAvailable(null);
          }}
          placeholder="yourname"
          aria-label={`Name at ${domain}`}
          className="max-w-[10rem]"
        />
        <span className="flex-1 truncate text-sm text-muted-foreground">
          @{domain}
        </span>
      </div>

      {problem ? (
        <p className="text-xs text-destructive">
          {describeLaWalletNameProblem(problem)}
        </p>
      ) : checking ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking…
        </p>
      ) : available === false ? (
        <p className="text-xs text-destructive">That name is taken.</p>
      ) : available ? (
        <p className="flex items-center gap-1 text-xs text-success">
          <Check className="h-3 w-3" />
          {laWalletAddress(name, domain)} is free
        </p>
      ) : null}

      {price ? (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
          <p className="text-sm">
            <span className="font-medium">
              {laWalletAddress(price.username, domain)}
            </span>{' '}
            <span className="text-muted-foreground">
              {price.amountSats === null
                ? 'has to be paid for.'
                : `costs ${price.amountSats.toLocaleString()} sats.`}
            </span>
          </p>
          {/* The number comes from the invoice the service raised, not from
              any rule of ours — there is no amount field to send and no price
              endpoint to read, so this is the only figure that is certain to
              match what the wallet gets charged */}
          <p className="text-xs text-muted-foreground">
            Paid once, from a wallet connected here. The name is yours
            afterwards and is never reissued to anybody else.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={isBuying}
              onClick={() =>
                void buy(price)
                  .then(() => setPrice(null))
                  .catch(() => {})
              }
            >
              {isBuying && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {price.amountSats === null
                ? 'Pay and claim'
                : `Pay ${price.amountSats.toLocaleString()} sats`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPrice(null)}>
              Not now
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          disabled={!!problem || available === false || isClaiming}
          onClick={() =>
            void claim({ username: name })
              .then((outcome) => {
                if (outcome.kind === 'price') setPrice(outcome);
              })
              .catch(() => {})
          }
        >
          {isClaiming && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Claim it
        </Button>
      )}
    </div>
  );
}

function AddressRow({ held }: { held: HeldAddress }) {
  const lawallet = useLaWallet();
  const { lightning } = useIdentity();
  const { toast } = useToast();
  const nwc = useNWC();

  /**
   * Taken from the merged entry rather than looked up in the account's own
   * list. The directory returns full records too, so an address that exists
   * only there is still editable — searching the shorter list for it found
   * nothing and rendered a blank space where an address should be.
   */
  const address = held.settings!;
  const [redirect, setRedirect] = useState(address.redirect ?? '');
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const full = held.address;
  const live = isLive(address) && !held.refusal;

  const setMode = async (mode: AddressMode) => {
    if (mode === 'CUSTOM_NWC') {
      /**
       * The connection string is this wallet's spending credential, and
       * pointing the address at it means handing that to the service. Said
       * plainly rather than framed as "connect", because the service can
       * spend from the wallet for as long as the connection lives.
       */
      /**
       * Derived rather than read through `getActiveConnection`, which sets
       * state as a side effect and cannot be called while rendering or from
       * inside an event handler without surprising a re-render.
       */
      const connection =
        nwc.connections.find(
          (entry) => entry.connectionString === nwc.activeConnection
        ) ?? nwc.connections[0];

      if (!connection) {
        toast({
          title: 'No wallet connected here yet',
          description:
            'Connect one over Nostr Wallet Connect first, then point this address at it.',
          variant: 'destructive',
        });
        return;
      }

      setBusy(true);
      try {
        const existing = lawallet.wallets[0];
        const wallet =
          existing ??
          (await lawallet.connectWallet({
            name: connection.alias || 'My wallet',
            connectionString: connection.connectionString,
          }));

        await lawallet.point({
          username: address.username,
          mode: 'CUSTOM_NWC',
          remoteWalletId: wallet.id,
        });
      } catch {
        // Reported by the mutation
      } finally {
        setBusy(false);
      }

      return;
    }

    await lawallet
      .point({
        username: address.username,
        mode,
        redirect: mode === 'IDLE' ? null : redirect.trim() || null,
      })
      .catch(() => {});
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{full}</p>
          {/* The service's own verdict wins over ours: it is the machine
              that answers the payment, and an address that resolves and then
              refuses looks identical to a working one from outside. */}
          <p className="text-xs text-muted-foreground">
            {held.refusal ?? describeMode(address)}
          </p>
        </div>

        {/* An address that resolves and then refuses looks identical to a
            working one until somebody tries to pay it */}
        <Badge
          variant={live ? 'secondary' : 'outline'}
          className={
            live
              ? 'bg-success/15 text-success'
              : held.refusal
                ? 'bg-destructive/15 text-destructive'
                : ''
          }
        >
          {live ? 'Receiving' : held.refusal ? 'Rejects payments' : 'Not pointed'}
        </Badge>

        {/* Only once it actually points somewhere. Offering to make an
            invoice for an address that resolves and refuses hands somebody a
            QR code that cannot be paid. */}
        {live && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => setReceiving(true)}
          >
            <ArrowDownLeft className="mr-1 h-3 w-3" />
            Receive
          </Button>
        )}

        {/* No delete button: the name would go back into the pool and the
            next claimant would quietly receive payments meant for this
            person. "Not pointed anywhere" below stops it receiving, and is
            reversible. */}
      </div>

      <AddressReceiveDialog
        address={full}
        open={receiving}
        onOpenChange={setReceiving}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={address.mode}
          onValueChange={(value) => void setMode(value as AddressMode)}
        >
          <SelectTrigger className="h-8 w-auto min-w-[11rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="IDLE">Not pointed anywhere</SelectItem>
            <SelectItem value="ALIAS">Forward to another address</SelectItem>
            <SelectItem value="PROXY_ALIAS">
              Forward, with zap receipts
            </SelectItem>
            <SelectItem value="CUSTOM_NWC">Your connected wallet</SelectItem>
          </SelectContent>
        </Select>

        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {(address.mode === 'ALIAS' || address.mode === 'PROXY_ALIAS') && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              value={redirect}
              onChange={(event) => setRedirect(event.target.value)}
              placeholder="you@getalby.com"
              aria-label="Forward to"
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              className="h-8"
              disabled={lawallet.isPointing || !redirect.trim()}
              onClick={() => void setMode(address.mode)}
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {address.mode === 'PROXY_ALIAS' && (
            <p className="text-xs text-muted-foreground">
              Payments pass through the service, which can issue Nostr zap
              receipts your destination cannot — at the cost of it briefly
              holding the money and taking a fee.
            </p>
          )}
        </div>
      )}

      {address.mode === 'CUSTOM_NWC' && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Plug className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {lawallet.domain} holds a connection that can spend from this
            wallet, so it can issue invoices for you. Revoke it there or in
            your wallet to stop that.
          </span>
        </p>
      )}

      {live && lightning.profileAddress !== full && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={lightning.isPublishing}
          onClick={() => {
            void lightning
              .setProfileAddress(full)
              .then(() => toast({ title: 'Zaps now arrive at this address' }))
              .catch(() => {});
          }}
        >
          <Zap className="mr-2 h-3.5 w-3.5" />
          Use for zaps
        </Button>
      )}
    </div>
  );
}
