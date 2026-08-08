import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Loader2,
  LogOut,
  Wallet,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { LightningAddressCard } from '@/components/wallet/LightningAddressCard';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import {
  useLnbitsPayments,
  useLnbitsWallet,
} from '@/hooks/useLnbitsWallet';
import { useToast } from '@/hooks/useToast';
import { msatToSat } from '@/lib/lnbits';
import { formatSats } from '@/lib/zap';
import { cn } from '@/lib/utils';

/** The NostrFeed custodial wallet, backed by our LNbits instance. */
export function LnbitsWalletCard() {
  const { isConnected, isLoading, connect, isConnecting, logout, instanceUrl } =
    useLnbitsAuth();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <EmptyState
        icon={Wallet}
        title="Connect your NostrFeed wallet"
        description="Signing a request with your Nostr key creates or opens your wallet. There is no password, and no API key is ever stored in this browser."
        action={
          <Button onClick={() => connect()} disabled={isConnecting}>
            {isConnecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Connect wallet
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <BalanceCard onDisconnect={logout} instanceUrl={instanceUrl} />
      <LightningAddressCard />
      <LinkedAccountCard />
      <ReceiveCard />
      <PaymentsCard />
    </div>
  );
}

/**
 * Shows which account the Nostr key resolved to.
 *
 * Worth surfacing because the mapping is invisible otherwise: people expect a
 * wallet to have its own login, and seeing their pubkey listed as the account
 * identity is what explains why there was never a password to set.
 */
function LinkedAccountCard() {
  const { account } = useLnbitsAuth();
  const { user } = useCurrentUser();

  if (!account) return null;

  // LNbits stores the pubkey it authenticated; a mismatch would mean the
  // session belongs to a different Nostr account than the one signed in here.
  const linked = account.pubkey;
  const mismatched = !!linked && !!user && linked !== user.pubkey;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Account</CardTitle>
      </CardHeader>

      <CardContent className="space-y-2 text-sm">
        <Row label="Signed in as" value={account.username || 'Nostr key'} />
        <Row label="Account id" value={account.id} mono />
        {linked && (
          <Row
            label="Linked key"
            value={`${linked.slice(0, 12)}…${linked.slice(-6)}`}
            mono
          />
        )}

        {mismatched && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
            This wallet session belongs to a different Nostr key than the one
            you're signed in with. Disconnect and reconnect to fix it.
          </p>
        )}

        <p className="pt-1 text-xs text-muted-foreground">
          There is no password. Your Nostr key is the account, proved by signing
          a request each time you connect.
        </p>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('truncate text-right', mono && 'font-mono text-xs')}>
        {value}
      </span>
    </div>
  );
}

function BalanceCard({
  onDisconnect,
  instanceUrl,
}: {
  onDisconnect: () => void;
  instanceUrl: string;
}) {
  const { wallet, balanceSats, isLoading, createWallet, isCreatingWallet } =
    useLnbitsWallet();

  if (!wallet && !isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm text-muted-foreground">
            Your account has no wallet yet.
          </p>
          <Button
            onClick={() => createWallet('NostrFeed')}
            disabled={isCreatingWallet}
          >
            {isCreatingWallet && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create a wallet
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            {wallet?.name ?? 'Wallet'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDisconnect}
            className="text-muted-foreground"
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            Disconnect
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div>
          {isLoading ? (
            <Skeleton className="h-9 w-28" />
          ) : (
            <p className="text-display tabular">
              {balanceSats.toLocaleString()}{' '}
              <span className="text-base font-normal text-muted-foreground">
                sats
              </span>
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Custodial, held at{' '}
          <a
            href={instanceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {new URL(instanceUrl).hostname}
          </a>
          . Keep only what you're willing to spend here.
        </p>
      </CardContent>
    </Card>
  );
}

function ReceiveCard() {
  const { createInvoice, isCreatingInvoice } = useLnbitsWallet();
  const { toast } = useToast();

  const [amount, setAmount] = useState('1000');
  const [invoice, setInvoice] = useState('');

  const generate = async () => {
    const sats = Number(amount);
    if (!Number.isFinite(sats) || sats <= 0) return;

    const payment = await createInvoice({ amountSats: sats, memo: 'NostrFeed' });
    setInvoice(payment.bolt11);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowDownLeft className="h-4 w-4 text-success" />
          Add sats
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="receive-amount" className="text-xs">
              Amount in sats
            </Label>
            <Input
              id="receive-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="numeric"
            />
          </div>
          <Button
            onClick={generate}
            disabled={isCreatingInvoice}
            className="self-end"
          >
            {isCreatingInvoice && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create invoice
          </Button>
        </div>

        {invoice && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="break-all font-mono text-xs text-muted-foreground">
              {invoice}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(invoice);
                toast({ title: 'Invoice copied' });
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy invoice
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PaymentsCard() {
  const { data: payments, isLoading } = useLnbitsPayments();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4 text-zap" />
          Recent activity
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">Loading…</p>
        ) : !payments?.length ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">
            Nothing yet. Zaps you send and receive will show up here.
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
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  {outgoing ? (
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ArrowDownLeft className="h-4 w-4 shrink-0 text-success" />
                  )}

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
