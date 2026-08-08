import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
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
import { IdentityCard } from '@/components/wallet/IdentityCard';
import { PasswordSignIn } from '@/components/wallet/PasswordSignIn';
import { ReceiveDialog } from '@/components/wallet/ReceiveDialog';
import { SendDialog } from '@/components/wallet/SendDialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLightningAddress } from '@/hooks/useLightningAddress';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useLnbitsPayments, useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useSeo } from '@/hooks/useSeo';
import { msatToSat } from '@/lib/lnbits';
import { formatSats } from '@/lib/zap';
import { cn } from '@/lib/utils';

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
      <div className="bg-gradient-to-br from-primary/12 via-primary/5 to-transparent px-6 py-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
          <Zap className="h-7 w-7 text-primary" />
        </div>

        <h2 className="text-title">Set up your wallet</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          One tap creates a lightning wallet and your own
          <span className="whitespace-nowrap"> name@address</span>, so people
          can zap you from any Nostr client.
        </p>

        <Button
          size="lg"
          className="mt-6"
          onClick={() => connect()}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Wallet className="mr-2 h-4 w-4" />
          )}
          Create my wallet
        </Button>

        {/* A toast is gone before it can be read, and this is the message
            most likely to need reading twice */}
        {connectError && (
          <p className="mx-auto mt-4 max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-left text-xs text-destructive">
            {connectError}
          </p>
        )}

        <div className="mx-auto mt-5 max-w-sm">
          <PasswordSignIn />
        </div>
      </div>

      <CardContent className="space-y-3 border-t pt-5">
        <Detail
          icon={KeyRound}
          title="No password"
          body="Your Nostr key is the account. You sign one request to prove it's yours; the key itself never leaves your signer."
        />
        <Detail
          icon={Zap}
          title="Zappable straight away"
          body="You get a lightning address you can publish to your profile, so zaps land in this wallet."
        />
        <Detail
          icon={ShieldCheck}
          title="Custodial — keep it small"
          body={`Balances are held at ${hostOf(instanceUrl)}. Treat it like cash in a pocket, not a savings account.`}
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
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
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
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/12 via-primary/5 to-transparent px-6 py-7">
          <p className="text-eyebrow">Balance</p>

          {isLoading ? (
            <Skeleton className="mt-2 h-11 w-40" />
          ) : (
            <p className="mt-1 text-display tabular">
              {balanceSats.toLocaleString()}
              <span className="ml-2 text-base font-normal text-muted-foreground">
                sats
              </span>
            </p>
          )}

          {address && (
            <p className="mt-2 truncate text-sm text-muted-foreground">
              {address}
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button size="lg" onClick={() => setReceiveOpen(true)}>
              <ArrowDownLeft className="mr-2 h-4 w-4" />
              Receive
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setSendOpen(true)}
              disabled={balanceSats <= 0}
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

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <Link
            to="/premium"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Sparkles className="h-4 w-4" />
            Buy relay access with these sats
          </Link>

          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="text-muted-foreground"
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            Disconnect
          </Button>
        </CardContent>

        <CardContent className="pt-0 text-xs text-muted-foreground">
          Held at{' '}
          <a
            href={instanceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {hostOf(instanceUrl)}
          </a>
          {account?.username ? ` as ${account.username}` : ''}. Custodial — keep
          only what you're willing to spend here.
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Activity</CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 px-6 pb-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-9" />
            ))}
          </div>
        ) : !payments?.length ? (
          <p className="px-6 pb-5 text-sm text-muted-foreground">
            Nothing yet. Zaps you send and receive show up here.
          </p>
        ) : (
          <ul className="divide-y border-t">
            {payments.map((payment) => {
              // LNbits signs the amount: negative is money leaving the wallet
              const outgoing = payment.amount < 0;
              const sats = Math.abs(msatToSat(payment.amount));

              return (
                <li
                  key={payment.payment_hash}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      outgoing ? 'bg-muted' : 'bg-success/10'
                    )}
                  >
                    {outgoing ? (
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ArrowDownLeft className="h-4 w-4 text-success" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1 truncate text-sm">
                    {payment.memo || (outgoing ? 'Sent' : 'Received')}
                  </span>

                  <span
                    className={cn(
                      'tabular shrink-0 text-sm font-medium',
                      outgoing ? 'text-muted-foreground' : 'text-success',
                      payment.status === 'pending' && 'opacity-60'
                    )}
                  >
                    {outgoing ? '−' : '+'}
                    {formatSats(sats)}
                  </span>
                </li>
              );
            })}
          </ul>
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
