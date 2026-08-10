import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountCard } from '@/components/wallet/AccountCard';
import { WalletKeys } from '@/components/wallet/WalletKeys';
import { IdentityCard } from '@/components/wallet/IdentityCard';
import { ExistingWalletSignIn } from '@/components/wallet/ExistingWalletSignIn';
import { ReceiveDialog } from '@/components/wallet/ReceiveDialog';
import { SendDialog } from '@/components/wallet/SendDialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLightningAddress } from '@/hooks/useLightningAddress';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useLnbitsPayments, useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useSeo } from '@/hooks/useSeo';
import { ADDRESS_DOMAIN } from '@/lib/lightningAddress';
import { msatToSat, paymentTimeMs } from '@/lib/lnbits';
import { formatSats } from '@/lib/zap';
import { serviceById } from '@/lib/services';
import { cn } from '@/lib/utils';

/** The standalone wallet site, promoted from the wallet people already use. */
const WALLET_SITE = serviceById('wallet');

/**
 * The wallet, as a place rather than a settings tab.
 *
 * It was reachable only from a tab inside settings, which meant a signed-in
 * person with no wallet saw no sign that one existed. Money needs a front
 * door.
 */
export function WalletPage() {
  useSeo({
    title: 'Wallet',
    description: 'Your NostrFeed lightning wallet: send, receive and get zapped.',
    path: '/wallet',
    noindex: true,
  });

  const { user } = useCurrentUser();
  const { isConnected, isLoading } = useLnbitsAuth();

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Wallet}
          title="Wallet"
          description="A lightning wallet tied to your Nostr key. No password, no signup — just a signature."
        />

        {!user ? (
          <EmptyState
            icon={Wallet}
            title="Log in to open your wallet"
            description="Your wallet belongs to your Nostr key, so it follows you to any device you sign in on."
            action={<LoginArea className="mx-auto max-w-60" />}
          />
        ) : isLoading ? (
          <ConnectingSkeleton />
        ) : !isConnected ? (
          <CreateWalletCard />
        ) : (
          <ConnectedWallet />
        )}
      </div>
    </Layout>
  );
}

function ConnectingSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Skeleton className="h-11 w-40" />
        <Skeleton className="h-4 w-64" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The offer, for someone who has no wallet yet.
 *
 * Says what the button does before it is pressed. Signing something is a real
 * decision, and "connect" on its own does not explain that no key leaves the
 * browser and no password is being created.
 */
function CreateWalletCard() {
  const { connect, isConnecting, connectError, instanceUrl } = useLnbitsAuth();

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-primary/15 via-primary/8 to-transparent px-6 py-12 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/20">
          <Zap className="h-8 w-8 text-primary" />
        </div>

        <h2 className="text-3xl font-bold tracking-tight">Set up your wallet</h2>

        <p className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-muted-foreground">
          One tap creates a lightning wallet and an address like
        </p>
        {/* The real domain, so the promise is checkable before it is accepted */}
        <p className="mt-2 font-mono text-sm font-medium text-foreground">
          you@{ADDRESS_DOMAIN}
        </p>
        <p className="mx-auto mt-2 max-w-sm text-base leading-relaxed text-muted-foreground">
          that people can zap from any Nostr client.
        </p>

        <Button
          size="lg"
          className="mt-8 w-full sm:w-auto"
          onClick={() => connect()}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Wallet className="mr-2 h-5 w-5" />
          )}
          {isConnecting ? 'Connecting…' : 'Create my wallet'}
        </Button>

        {connectError && (
          <div className="mx-auto mt-6 max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-left">
            <p className="text-sm font-medium text-destructive">
              Couldn't create your wallet
            </p>
            <p className="mt-1 text-xs leading-relaxed text-destructive/80">
              {connectError}
            </p>
          </div>
        )}

        <div className="mt-6 flex items-center justify-center">
          <ExistingWalletSignIn />
        </div>
      </div>

      <CardContent className="space-y-4 border-t pt-6">
        <Detail
          icon={KeyRound}
          title="No password"
          body="Your Nostr key is the account. Sign once to prove it's yours — the key itself never leaves your signer."
        />
        <Detail
          icon={Zap}
          title="Receive zaps immediately"
          body="Get a lightning address to publish on your profile. Zaps land in your wallet instantly."
        />
        <Detail
          icon={ShieldCheck}
          title="Custodial—keep it small"
          body={`Balances are held at ${hostOf(instanceUrl)}. Treat it like cash in a pocket, not savings.`}
        />
      </CardContent>
    </Card>
  );
}

function Detail({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Zap;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4 rounded-lg p-3 hover:bg-muted/50 transition-colors">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function ConnectedWallet() {
  const { logout, instanceUrl, account } = useLnbitsAuth();
  const { wallet, balanceSats, isLoading, createWallet, isCreatingWallet } =
    useLnbitsWallet();
  const { address } = useLightningAddress();

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  // An account can exist with no wallet on it — the one state where the page
  // has to offer the wallet itself rather than what to do with it
  if (!wallet && !isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Your account is connected, but it has no wallet on it yet.
          </p>
          <Button
            onClick={() => createWallet('NostrFeed')}
            disabled={isCreatingWallet}
          >
            {isCreatingWallet && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create a wallet
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/15 via-primary/8 to-transparent px-6 py-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Balance</p>

          {isLoading ? (
            <Skeleton className="mt-3 h-12 w-48 rounded-lg" />
          ) : (
            <p className="mt-2 text-5xl font-bold tracking-tight tabular">
              {balanceSats.toLocaleString()}
              <span className="ml-3 text-lg font-normal text-muted-foreground">
                sats
              </span>
            </p>
          )}

          {address && (
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-muted/50 px-2 py-1 text-xs font-mono">
                {address}
              </code>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button size="lg" onClick={() => setReceiveOpen(true)} className="w-full">
              <ArrowDownLeft className="mr-2 h-4 w-4" />
              Receive
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setSendOpen(true)}
              disabled={balanceSats <= 0}
              className="w-full"
            >
              <ArrowUpRight className="mr-2 h-4 w-4" />
              Send
            </Button>
          </div>
        </div>
      </Card>

      <IdentityCard />

      <ActivityCard />

      <AccountCard />

      <WalletKeys />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <Link
            to="/premium"
            className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            <span>Buy relay access with these sats</span>
            <span className="ml-auto">→</span>
          </Link>

          {/* The same wallet with nothing around it — useful on a phone, and
              the one of the three services with no version inside this app */}
          <a
            href={WALLET_SITE.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-accent/60"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
            <span>Open this wallet on its own at {WALLET_SITE.host}</span>
            <span className="ml-auto text-muted-foreground">↗</span>
          </a>

          {/* The other wallet. Worth naming here rather than only in the nav,
              because "the balance is held by whoever runs the server" is the
              exact objection ecash answers */}
          <Link
            to="/ecash"
            className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            <Banknote className="h-4 w-4" />
            <span>Hold sats as private ecash instead</span>
            <span className="ml-auto">→</span>
          </Link>

          <Button
            variant="outline"
            size="sm"
            onClick={logout}
            className="w-full"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Disconnect account
          </Button>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium">Custodial wallet</p>
            <p className="leading-relaxed">
              Balance held at{' '}
              <a
                href={instanceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                {hostOf(instanceUrl)}
              </a>
              {account?.username && (
                <>
                  {' '}
                  as <span className="font-mono">{account.username}</span>
                </>
              )}
              . Keep only what you plan to spend.
            </p>
          </div>
        </CardContent>
      </Card>

      <ReceiveDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        lightningAddress={address ?? undefined}
      />
      <SendDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        balanceSats={balanceSats}
      />
    </div>
  );
}

function ActivityCard() {
  const { data: payments, isLoading } = useLnbitsPayments();
  const [expanded, setExpanded] = useState<string | null>(null);

  const sortedPayments = useMemo(() => {
    return [...(payments || [])].sort(
      (a, b) => paymentTimeMs(b.time) - paymentTimeMs(a.time)
    );
  }, [payments]);

  const formatTime = (timestamp: string | number | undefined) => {
    const ms = paymentTimeMs(timestamp);
    if (!ms) return 'Unknown time';

    const date = new Date(ms);

    // Validate the date is valid
    if (isNaN(date.getTime())) return 'Unknown time';

    const now = new Date();
    const diffSeconds = (now.getTime() - date.getTime()) / 1000;

    if (diffSeconds < 60) return 'Just now';
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)}d ago`;

    try {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      });
    } catch {
      return 'Unknown time';
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-br from-slate-50 to-transparent dark:from-slate-950/40 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <ArrowDownLeft className="h-4 w-4 text-primary" />
          </div>
          Activity
          {payments?.length ? (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {payments.length} transaction{payments.length !== 1 ? 's' : ''}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 px-6 py-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : !sortedPayments?.length ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing yet. Zaps and transactions will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y border-t">
            {sortedPayments.slice(0, 10).map((payment) => {
              const outgoing = payment.amount < 0;
              const sats = Math.abs(msatToSat(payment.amount));
              const isExpanded = expanded === payment.payment_hash;

              return (
                <li key={payment.payment_hash} className="overflow-hidden">
                  <button
                    onClick={() => setExpanded(isExpanded ? null : payment.payment_hash)}
                    className="w-full flex items-center gap-3 px-6 py-3 hover:bg-muted/50 transition-colors text-left"
                  >
                    <span
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                        outgoing ? 'bg-muted' : 'bg-success/10'
                      )}
                    >
                      {outgoing ? (
                        <ArrowUpRight className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ArrowDownLeft className="h-5 w-5 text-success" />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {payment.memo || (outgoing ? 'Sent' : 'Received')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(payment.time)}
                      </p>
                    </span>

                    <span
                      className={cn(
                        'tabular shrink-0 text-sm font-semibold',
                        outgoing ? 'text-muted-foreground' : 'text-success',
                        payment.status === 'pending' && 'opacity-60'
                      )}
                    >
                      {outgoing ? '−' : '+'}
                      {formatSats(sats)}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t bg-muted/30 px-6 py-3 text-xs space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status</span>
                        <span className={cn(
                          'font-medium capitalize',
                          payment.status === 'pending' ? 'text-yellow-600' : 'text-success'
                        )}>
                          {payment.status || 'completed'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amount (msat)</span>
                        <span className="font-mono">{Math.abs(payment.amount)}</span>
                      </div>
                      {payment.memo && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Note</span>
                          <span className="font-medium truncate">{payment.memo}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Hash</span>
                        <code className="font-mono text-[10px] truncate max-w-[200px]">
                          {payment.payment_hash}
                        </code>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {sortedPayments?.length > 10 && (
          <div className="border-t px-6 py-3 text-center text-xs text-muted-foreground">
            Showing latest 10 of {sortedPayments.length} transactions
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Hostname of a configured URL, falling back to the raw value if it is not one. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default WalletPage;
