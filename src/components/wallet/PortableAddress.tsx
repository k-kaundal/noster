import { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, Plug, Zap } from 'lucide-react';
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
} from '@/lib/lawallet';

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
          A name that moves with you
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          An address at {lawallet.domain} that you point wherever you like — at
          a wallet you connect, or on to another address. Change the
          destination whenever; the name stays the same.
        </p>
      </div>

      {lawallet.held.map((held) =>
        held.settings ? (
          <AddressRow key={held.username} username={held.username} />
        ) : (
          <LinkedAddress key={held.username} address={held.address} />
        )
      )}

      {/* Only when they hold nothing here at all. Offering a claim form to
          somebody who already has an address — including one the directory
          found rather than their own account list — is how a person ends up
          with two names and their zaps arriving at the older one. */}
      {!lawallet.held.length && !lawallet.isLoading && <ClaimForm />}
    </div>
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
function LinkedAddress({ address }: { address: string }) {
  const { lightning } = useIdentity();
  const { toast } = useToast();

  const onProfile = lightning.profileAddress === address;

  return (
    <div className="flex items-center gap-2 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{address}</p>
        <p className="text-xs text-muted-foreground">
          Already linked to your key. Manage where it points where you set it
          up.
        </p>
      </div>

      {onProfile ? (
        <Badge variant="secondary" className="gap-1 bg-success/15 text-success">
          <Zap className="h-3 w-3" />
          Zaps land here
        </Badge>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
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
  );
}

function ClaimForm() {
  const { claim, isClaiming, checkName, domain } = useLaWallet();
  const { suggestion } = useIdentity();

  const [name, setName] = useState(() => suggestLaWalletName(suggestion));
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

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

      <Button
        size="sm"
        disabled={!!problem || available === false || isClaiming}
        onClick={() => void claim({ username: name }).catch(() => {})}
      >
        {isClaiming && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        Claim it
      </Button>
    </div>
  );
}

function AddressRow({ username }: { username: string }) {
  const lawallet = useLaWallet();
  const { lightning } = useIdentity();
  const { toast } = useToast();
  const nwc = useNWC();

  const address = lawallet.addresses.find((entry) => entry.username === username);
  const [redirect, setRedirect] = useState(address?.redirect ?? '');
  const [busy, setBusy] = useState(false);

  if (!address) return null;

  const full = laWalletAddress(address.username, lawallet.domain);
  const live = isLive(address);

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
          <p className="text-xs text-muted-foreground">{describeMode(address)}</p>
        </div>

        {/* An address that resolves and then refuses looks identical to a
            working one until somebody tries to pay it */}
        <Badge
          variant={live ? 'secondary' : 'outline'}
          className={live ? 'bg-success/15 text-success' : ''}
        >
          {live ? 'Receiving' : 'Not pointed'}
        </Badge>

        {/* No delete button: the name would go back into the pool and the
            next claimant would quietly receive payments meant for this
            person. "Not pointed anywhere" below stops it receiving, and is
            reversible. */}
      </div>

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
