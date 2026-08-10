import { useState } from 'react';
import { ArrowUpRight, Check, Copy, Loader2, Wallet } from 'lucide-react';
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
import { useCashuWallet } from '@/hooks/useCashuWallet';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useToast } from '@/hooks/useToast';

/**
 * Longest token still worth drawing as a QR.
 *
 * Well under what error-correction level M can hold, because the versions near
 * that ceiling are so dense that a phone camera gives up on them.
 */
const QR_LIMIT = 1200;

interface EcashSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balanceSats: number;
  /** Withdrawals are refused while the mint has NUT-05 switched off. */
  canWithdraw?: boolean;
}

/**
 * Three ways ecash leaves: as a token, as a lightning payment, or back into
 * the lightning wallet on the next page.
 */
export function EcashSendDialog({
  open,
  onOpenChange,
  balanceSats,
  canWithdraw = true,
}: EcashSendDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
              <ArrowUpRight className="h-4 w-4 text-primary" />
            </div>
            Send ecash
          </DialogTitle>
          <DialogDescription>
            {balanceSats.toLocaleString()} sats available.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="token">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="token">Token</TabsTrigger>
            <TabsTrigger value="invoice" disabled={!canWithdraw}>
              Invoice
            </TabsTrigger>
            <TabsTrigger value="wallet" disabled={!canWithdraw}>
              My wallet
            </TabsTrigger>
          </TabsList>

          <TabsContent value="token" className="pt-4">
            <TokenPanel balanceSats={balanceSats} />
          </TabsContent>

          <TabsContent value="invoice" className="pt-4">
            <InvoicePanel onDone={() => onOpenChange(false)} />
          </TabsContent>

          <TabsContent value="wallet" className="pt-4">
            <WithdrawPanel
              balanceSats={balanceSats}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Cutting a token to hand over.
 *
 * The balance drops the moment it is made, not when it is redeemed — the
 * string is the money, and this wallet no longer holds a copy it could spend.
 * Saying so on the screen is the difference between a confusing balance and an
 * understood one.
 */
function TokenPanel({ balanceSats }: { balanceSats: number }) {
  const { send, isSending } = useCashuWallet();
  const { toast } = useToast();

  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [token, setToken] = useState('');

  const sats = Number(amount);
  const valid = Number.isFinite(sats) && sats > 0 && sats <= balanceSats;

  if (token) {
    return (
      <div className="space-y-4">
        {/* A token is as long as the number of proofs behind it, and past a
            point the code is either impossible to encode or too dense for a
            phone camera. Copying it is the reliable path either way */}
        {token.length <= QR_LIMIT ? (
          <QrCode value={token} label="QR code for the ecash token" size={192} />
        ) : (
          <p className="rounded-lg bg-muted/50 p-3 text-center text-xs text-muted-foreground">
            Too long for a scannable code. Copy the token instead.
          </p>
        )}

        <div className="flex gap-2">
          <Input
            readOnly
            value={token}
            onClick={(event) => event.currentTarget.select()}
            className="flex-1 bg-muted/50 font-mono text-xs"
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={async () => {
              await navigator.clipboard.writeText(token);
              toast({ title: 'Token copied' });
            }}
            aria-label="Copy token"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
            This string is the money. It has already left your balance — send it
            to someone, or paste it back into Receive to take it back. Lose it
            and the sats are gone.
          </p>
        </div>

        <Button variant="ghost" className="w-full" onClick={() => setToken('')}>
          Send another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label
          htmlFor="ecash-send-amount"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Amount
        </Label>
        <Input
          id="ecash-send-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="numeric"
          placeholder="0"
          className="text-xl font-bold tabular-nums"
        />
        {sats > balanceSats && (
          <p className="text-xs text-destructive">
            More than you have. Your balance is{' '}
            {balanceSats.toLocaleString()} sats.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="ecash-send-memo"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Note (optional)
        </Label>
        <Input
          id="ecash-send-memo"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="Travels with the token"
        />
      </div>

      <Button
        className="w-full"
        size="lg"
        disabled={!valid || isSending}
        onClick={async () => {
          setToken(await send({ amountSats: sats, memo: memo.trim() }));
        }}
      >
        {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Create token
      </Button>
    </div>
  );
}

/** Paying a bolt11 invoice out of the ecash balance. */
function InvoicePanel({ onDone }: { onDone: () => void }) {
  const { payInvoice, isPaying } = useCashuWallet();
  const { toast } = useToast();
  const [invoice, setInvoice] = useState('');

  const valid = /^lnbc/i.test(invoice.trim());

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label
          htmlFor="ecash-invoice"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Lightning invoice
        </Label>
        <Textarea
          id="ecash-invoice"
          value={invoice}
          onChange={(event) => setInvoice(event.target.value)}
          placeholder="lnbc…"
          rows={4}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          The mint pays it and returns the unused fee reserve as change.
        </p>
      </div>

      <Button
        className="w-full"
        size="lg"
        disabled={!valid || isPaying}
        onClick={async () => {
          const result = await payInvoice(invoice);
          toast({
            title: 'Paid',
            description: `${result.amountSats.toLocaleString()} sats sent${
              result.feeSats ? `, ${result.feeSats.toLocaleString()} in fees` : ''
            }.`,
          });
          setInvoice('');
          onDone();
        }}
      >
        {isPaying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Pay
      </Button>
    </div>
  );
}

/**
 * Moving ecash back into the lightning wallet.
 *
 * Two wallets in one app that cannot pay each other is a filing problem, not a
 * feature. This makes an invoice on one side and melts on the other, so the
 * round trip is one button instead of a copied invoice.
 */
function WithdrawPanel({
  balanceSats,
  onDone,
}: {
  balanceSats: number;
  onDone: () => void;
}) {
  const { payInvoice, isPaying } = useCashuWallet();
  const { wallet, createInvoice, isCreatingInvoice } = useLnbitsWallet();
  const { toast } = useToast();
  const [amount, setAmount] = useState('');

  const sats = Number(amount);
  const valid = Number.isFinite(sats) && sats > 0 && sats <= balanceSats;

  if (!wallet) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Set up your lightning wallet first, then you can move ecash into it.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label
          htmlFor="ecash-withdraw"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Amount
        </Label>
        <Input
          id="ecash-withdraw"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="numeric"
          placeholder="0"
          className="text-xl font-bold tabular-nums"
        />
        <p className="text-xs text-muted-foreground">
          The mint's fee comes out of your ecash on top of this, so leave a
          little headroom.
        </p>
      </div>

      <Button
        className="w-full"
        size="lg"
        disabled={!valid || isPaying || isCreatingInvoice}
        onClick={async () => {
          const { bolt11 } = await createInvoice({
            amountSats: sats,
            memo: 'Ecash withdrawal',
          });

          await payInvoice(bolt11);

          toast({
            title: 'Moved to your lightning wallet',
            description: `${sats.toLocaleString()} sats.`,
          });
          setAmount('');
          onDone();
        }}
      >
        {isPaying || isCreatingInvoice ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Wallet className="mr-2 h-4 w-4" />
        )}
        Move to lightning wallet
      </Button>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        Both wallets are yours — this is a lightning payment from one to the
        other, so it settles in seconds.
      </p>
    </div>
  );
}
