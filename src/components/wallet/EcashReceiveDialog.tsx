import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Zap,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { QrCode } from '@/components/wallet/QrCode';
import { QrScanner } from '@/components/wallet/QrScanner';
import { useCashuWallet, useMintQuoteStatus } from '@/hooks/useCashuWallet';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useToast } from '@/hooks/useToast';
import { looksLikeToken, mintHost, type TokenPreview } from '@/lib/cashu';
import type { PendingQuote } from '@/lib/cashuStore';
import { cn } from '@/lib/utils';

const PRESETS = [100, 1_000, 5_000, 21_000];

interface EcashReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Deposits are refused while the mint has NUT-04 switched off. */
  canDeposit?: boolean;
  minSats?: number;
  maxSats?: number;
}

/**
 * Two ways ecash arrives: bought from the mint, or handed over by someone.
 *
 * Buying is first because it is the only one that works before anyone has sent
 * you anything.
 */
export function EcashReceiveDialog({
  open,
  onOpenChange,
  canDeposit = true,
  minSats,
  maxSats,
}: EcashReceiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-success/10">
              <ArrowDownLeft className="h-4 w-4 text-success" />
            </div>
            Receive ecash
          </DialogTitle>
          <DialogDescription>
            Buy ecash with lightning, or redeem a token someone sent you — paste it, or scan the card.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={canDeposit ? 'deposit' : 'token'}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="deposit" disabled={!canDeposit}>
              Lightning
            </TabsTrigger>
            <TabsTrigger value="token">Scan or paste</TabsTrigger>
          </TabsList>

          <TabsContent value="deposit" className="pt-4">
            <DepositPanel minSats={minSats} maxSats={maxSats} />
          </TabsContent>

          <TabsContent value="token" className="pt-4">
            <RedeemPanel onDone={() => onOpenChange(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Buying ecash: pay an invoice, the mint issues proofs.
 *
 * The claim is automatic once the invoice settles. Leaving it to a button
 * would mean a paid invoice and no balance for anyone who looked away, which
 * looks exactly like losing the money.
 */
function DepositPanel({
  minSats,
  maxSats,
}: {
  minSats?: number;
  maxSats?: number;
}) {
  const {
    requestDeposit,
    isRequestingDeposit,
    claimDeposit,
    isClaimingDeposit,
  } = useCashuWallet();
  const { wallet, payInvoice, isPaying } = useLnbitsWallet();
  const { toast } = useToast();

  const [amount, setAmount] = useState('1000');
  const [pending, setPending] = useState<PendingQuote | null>(null);
  const [claimed, setClaimed] = useState(0);

  const { isPaid, isIssued } = useMintQuoteStatus(pending?.quote);
  const claiming = useRef(false);

  useEffect(() => {
    if (!pending || !isPaid || claiming.current) return;

    claiming.current = true;
    claimDeposit(pending)
      .then((sats) => {
        setClaimed(sats);
        setPending(null);
      })
      .catch(() => undefined)
      .finally(() => {
        claiming.current = false;
      });
  }, [pending, isPaid, claimDeposit]);

  const sats = Number(amount);
  const tooSmall = minSats !== undefined && sats < minSats;
  const tooLarge = maxSats !== undefined && sats > maxSats;
  const valid = Number.isFinite(sats) && sats > 0 && !tooSmall && !tooLarge;

  const request = async () => {
    if (!valid) return;
    const { pending: quote } = await requestDeposit(sats);
    setClaimed(0);
    setPending(quote);
  };

  if (claimed > 0) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
          <Check className="h-6 w-6 text-success" />
        </div>
        <p className="text-lg font-semibold">
          {claimed.toLocaleString()} sats in ecash
        </p>
        <p className="text-sm text-muted-foreground">
          It's yours to hold now — the mint has no record of who it belongs to.
        </p>
        <Button variant="outline" className="w-full" onClick={() => setClaimed(0)}>
          Buy more
        </Button>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="space-y-4">
        <QrCode
          value={`lightning:${pending.request}`}
          label="QR code for the deposit invoice"
          size={192}
        />

        <div
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium',
            isPaid || isIssued
              ? 'border-success/30 bg-success/10 text-success-strong'
              : 'border-muted bg-muted/40 text-muted-foreground'
          )}
          role="status"
        >
          {isPaid || isClaimingDeposit ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Paid — issuing your ecash…</span>
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                Waiting for {pending.amountSats.toLocaleString()} sats…
              </span>
            </>
          )}
        </div>

        <div className="flex gap-2">
          <Input
            readOnly
            value={pending.request}
            onClick={(event) => event.currentTarget.select()}
            className="flex-1 bg-muted/50 font-mono text-xs"
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={async () => {
              await navigator.clipboard.writeText(pending.request);
              toast({ title: 'Invoice copied' });
            }}
            aria-label="Copy invoice"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>

        {/* The sats are usually already in this app, one wallet over. Making
            someone copy an invoice into a second tab to move them is a step
            that exists only because the two wallets were built separately */}
        {wallet && (
          <Button
            className="w-full"
            onClick={async () => {
              await payInvoice(pending.request);
              toast({ title: 'Paid from your lightning wallet' });
            }}
            disabled={isPaying}
          >
            {isPaying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-2 h-4 w-4" />
            )}
            Pay from my lightning wallet
          </Button>
        )}

        <Button variant="outline" className="w-full" asChild>
          <a href={`lightning:${pending.request}`}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open in another wallet
          </a>
        </Button>

        <Button
          variant="ghost"
          className="w-full"
          onClick={() => setPending(null)}
        >
          Change amount
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label
          htmlFor="ecash-amount"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Amount
        </Label>
        <Input
          id="ecash-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="numeric"
          className="text-xl font-bold tabular-nums"
        />
        <div className="flex flex-wrap gap-1.5 pt-1">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant={Number(amount) === preset ? 'default' : 'outline'}
              onClick={() => setAmount(String(preset))}
              className="text-xs"
            >
              {preset.toLocaleString()}
            </Button>
          ))}
        </div>

        {tooSmall && (
          <p className="text-xs text-destructive">
            The mint's smallest deposit is {minSats!.toLocaleString()} sats.
          </p>
        )}
        {tooLarge && (
          <p className="text-xs text-destructive">
            The mint's largest deposit is {maxSats!.toLocaleString()} sats.
          </p>
        )}
      </div>

      <Button
        className="w-full"
        size="lg"
        onClick={request}
        disabled={!valid || isRequestingDeposit}
      >
        {isRequestingDeposit && (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        )}
        Get an invoice
      </Button>
    </div>
  );
}

/** Redeeming a token: paste it, it becomes balance. */
function RedeemPanel({ onDone }: { onDone: () => void }) {
  const { receive, isReceiving, inspect, mintUrl } = useCashuWallet();
  const { toast } = useToast();
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<TokenPreview | null>(null);

  const valid = looksLikeToken(token);

  /**
   * Read on paste, not on submit. What matters before pressing the button is
   * which mint issued it — ecash from elsewhere cannot join this balance, and
   * that should be visible while there is still a decision to make.
   */
  useEffect(() => {
    let cancelled = false;

    if (!valid) {
      setPreview(null);
      return;
    }

    void inspect(token).then((result) => {
      if (!cancelled) setPreview(result);
    });

    return () => {
      cancelled = true;
    };
  }, [token, valid, inspect]);

  const foreign = !!preview && preview.mint !== mintUrl;

  const redeem = async () => {
    /**
     * The failure is reported by the mutation, and the token stays in the box
     * rather than being cleared. It is money: a redeem that failed because the
     * mint blinked must not also lose the string that would have worked on the
     * next try.
     */
    const sats = await receive(token).catch(() => null);
    if (sats === null) return;

    toast({
      title: 'Redeemed',
      description: `${sats.toLocaleString()} sats added to your ecash.`,
    });
    setToken('');
    setPreview(null);
    onDone();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label
          htmlFor="ecash-token"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Token
        </Label>
        <Textarea
          id="ecash-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="cashuB…"
          rows={5}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Anyone holding this string can redeem it, so the first wallet to paste
          it wins.
        </p>
      </div>

      {/*
        Scanning fills the same box rather than redeeming straight away, so the
        mint check below still happens and nothing is claimed before it has
        been looked at.
      */}
      <QrScanner onToken={setToken} />

      {preview && (
        <div
          className={cn(
            'space-y-1.5 rounded-lg border p-3 text-sm',
            foreign && 'border-warning/40 bg-warning/5'
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-medium">
              {preview.amountSats.toLocaleString()} sats
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Mint</span>
            <span className="truncate font-medium">
              {mintHost(preview.mint)}
            </span>
          </div>

          {preview.memo && (
            <p className="line-clamp-2 pt-1 text-xs italic text-muted-foreground">
              “{preview.memo}”
            </p>
          )}

          {foreign ? (
            /*
              Said as a fact about the token rather than as a failure. Ecash is
              issued by one mint and only that mint will honour it, so this is
              not a thing to fix — it is a thing to know before trying.
            */
            <p className="flex items-start gap-1.5 pt-1 text-xs text-warning-strong">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This is from a different mint. Your wallet holds ecash from{' '}
              {mintHost(mintUrl)}, and the two cannot be merged — redeem it in a
              wallet on {mintHost(preview.mint)} instead.
            </p>
          ) : (
            <p className="flex items-center gap-1.5 pt-1 text-xs text-success-strong">
              <Check className="h-3.5 w-3.5 shrink-0" />
              Same mint as your wallet.
            </p>
          )}
        </div>
      )}

      <Button
        className="w-full"
        size="lg"
        onClick={redeem}
        disabled={!valid || isReceiving || foreign}
      >
        {isReceiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Redeem
      </Button>
    </div>
  );
}
