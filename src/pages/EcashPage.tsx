import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Clock,
  EyeOff,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Wallet,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoginArea } from '@/components/auth/LoginArea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EcashReceiveDialog } from '@/components/wallet/EcashReceiveDialog';
import { EcashSendDialog } from '@/components/wallet/EcashSendDialog';
import { MintInfoCard } from '@/components/wallet/MintInfoCard';
import {
  MintDiscovery,
  RecommendMint,
} from '@/components/wallet/MintDiscovery';
import { useCashuMint } from '@/hooks/useCashuMint';
import { useCashuWallet } from '@/hooks/useCashuWallet';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSeo } from '@/hooks/useSeo';
import { mintHost } from '@/lib/cashu';
import { clearCashu, type PendingQuote } from '@/lib/cashuStore';

/**
 * Ecash: money you hold, at a mint that doesn't know it's yours.
 *
 * Separate from the lightning wallet on purpose. That one is an account with a
 * balance someone else keeps for you; this one is a set of secrets in your
 * browser that any wallet can spend. They pay each other over lightning, so
 * moving between them is a payment, not a transfer.
 */
export function EcashPage() {
  useSeo({
    title: 'Ecash',
    description: 'Private, bearer ecash at the NostrFeed Cashu mint.',
    path: '/ecash',
    noindex: true,
  });

  const { user } = useCurrentUser();

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Banknote}
          title="Ecash"
          description="Bearer sats you hold yourself. The mint issues them and redeems them, but never learns whose they are."
        />

        {!user ? (
          <EmptyState
            icon={Banknote}
            title="Log in to hold ecash"
            description="Your balance is backed up to your relays, encrypted to your key, so it follows you between devices."
            action={<LoginArea className="mx-auto max-w-60" />}
          />
        ) : (
          <Ecash />
        )}
      </div>
    </Layout>
  );
}

function Ecash() {
  const { mint } = useCashuMint();
  const {
    available,
    balanceSats,
    isLoading,
    mintUrl,
    pendingQuotes,
    refresh,
  } = useCashuWallet();

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  /**
   * Browsing on someone else's npub.
   *
   * Ecash needs a key that can sign: the backup is encrypted to its holder, so
   * this session could neither read one nor write one. Every button would work
   * at the mint — proofs are bearer tokens and need no signature — and then
   * record itself nowhere, which is how a wallet loses money without saying so.
   */
  if (!available) {
    return (
      <EmptyState
        icon={Banknote}
        title="Log in to hold ecash"
        description="You're browsing read-only. Ecash lives in your browser and is backed up encrypted to your own key, so it needs one you can sign with."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-emerald-500/15 via-emerald-500/8 to-transparent px-6 py-8">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ecash balance
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={refresh}
              aria-label="Refresh balance"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

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

          <p className="mt-2 text-xs text-muted-foreground">
            Held at {mintHost(mintUrl)}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="w-full"
              onClick={() => setReceiveOpen(true)}
            >
              <ArrowDownLeft className="mr-2 h-4 w-4" />
              Receive
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => setSendOpen(true)}
              disabled={balanceSats <= 0}
            >
              <ArrowUpRight className="mr-2 h-4 w-4" />
              Send
            </Button>
          </div>
        </div>
      </Card>

      {pendingQuotes.length > 0 && <PendingDeposits quotes={pendingQuotes} />}

      <MintInfoCard />

      {/* NIP-87: who among the people you follow keeps money where */}
      <MintDiscovery currentMintUrl={mintUrl} />

      <RecommendMint mintUrl={mintUrl} />

      <HowItWorks />

      <ForgetOnThisDevice balanceSats={balanceSats} />

      <Card>
        <CardContent className="pt-6">
          <Link
            to="/wallet"
            className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Wallet className="h-4 w-4" />
            <span>Your lightning wallet</span>
            <span className="ml-auto">→</span>
          </Link>
        </CardContent>
      </Card>

      <EcashReceiveDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        canDeposit={mint?.canDeposit ?? true}
        minSats={mint?.deposit.minSats}
        maxSats={mint?.deposit.maxSats}
      />
      <EcashSendDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        balanceSats={balanceSats}
        canWithdraw={mint?.canWithdraw ?? true}
      />
    </div>
  );
}

/**
 * Deposits that were quoted but never turned into proofs.
 *
 * Between paying an invoice and claiming the ecash there is a moment where the
 * mint owes sats against a quote id nobody but this browser knows. Showing
 * those quotes is what stops a closed tab from being a lost deposit.
 */
function PendingDeposits({ quotes }: { quotes: PendingQuote[] }) {
  const { claimDeposit, isClaimingDeposit } = useCashuWallet();

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          Unfinished deposits
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          These invoices were created but the ecash was never claimed. If you
          paid one, claim it now.
        </p>

        {quotes.map((quote) => (
          <div
            key={quote.quote}
            className="flex items-center gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {quote.amountSats.toLocaleString()} sats
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {new Date(quote.createdAt * 1000).toLocaleString()}
              </p>
            </div>

            <Button
              size="sm"
              variant="outline"
              disabled={isClaimingDeposit}
              onClick={() => claimDeposit(quote).catch(() => undefined)}
            >
              {isClaimingDeposit && (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              )}
              Claim
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Wiping the local copy, on purpose.
 *
 * Signing out deliberately leaves ecash alone: unlike a session token it is
 * the money itself, and clearing it on a device whose backup never reached a
 * relay would be a wallet emptied by a logout. Removing it is therefore its
 * own decision, made once, with the consequence spelled out.
 */
function ForgetOnThisDevice({ balanceSats }: { balanceSats: number }) {
  const { user } = useCurrentUser();
  const { refresh } = useCashuWallet();
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-destructive/30">
      <CardContent className="space-y-3 pt-6">
        <p className="text-sm font-medium">Ecash on this device</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Signing out of Nostr leaves this balance here, because it lives in
          this browser rather than on a server. Remove it when you're finished
          on a shared computer — it comes back from your relays the next time
          you sign in, as long as the backup got through.
        </p>

        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Remove from this device
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove {balanceSats.toLocaleString()} sats from this browser?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The proofs are deleted from this device. If your encrypted
                backup reached your relays they come back on your next sign-in;
                if it never did, the sats are gone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (user) clearCashu(user.pubkey);
                  refresh();
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function HowItWorks() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">What ecash is</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <Point
          icon={EyeOff}
          title="The mint can't see your balance"
          body="Sats are issued as blinded tokens, so the mint signs something it cannot read. It knows tokens were issued and later spent — not that the same person did both."
        />
        <Point
          icon={Banknote}
          title="Whoever holds it, owns it"
          body="A token is like a banknote: there is no account to recover it from. Send it to the wrong person and it is theirs."
        />
        <Point
          icon={ShieldAlert}
          title="Keep it small"
          body="The mint can go offline or close, and ecash it issued would go with it. It is spending money, not savings."
        />
      </CardContent>
    </Card>
  );
}

function Point({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Banknote;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4 rounded-lg p-3 transition-colors hover:bg-muted/50">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export default EcashPage;
