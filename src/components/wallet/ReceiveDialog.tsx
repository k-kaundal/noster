import { useEffect, useState } from 'react';
import { ArrowDownLeft, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QrCode } from '@/components/wallet/QrCode';
import { useInvoiceStatus, useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

/** Amounts people actually ask for, so most requests need no typing. */
const PRESETS = [1_000, 5_000, 21_000, 100_000];

interface ReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown alongside the invoice, since it works without one being made. */
  lightningAddress?: string;
}

/**
 * Asking for sats: an invoice for one payment, or the address for any number.
 *
 * The address is shown first because it is reusable — an invoice is the right
 * answer only when a specific amount is being requested.
 */
export function ReceiveDialog({
  open,
  onOpenChange,
  lightningAddress,
}: ReceiveDialogProps) {
  const { createInvoice, isCreatingInvoice } = useLnbitsWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState('1000');
  const [memo, setMemo] = useState('');
  const [invoice, setInvoice] = useState('');
  const [paymentHash, setPaymentHash] = useState('');

  const { isPaid } = useInvoiceStatus(invoice ? paymentHash : undefined);

  // Clear on close, so reopening never shows a stale invoice as if it were new
  useEffect(() => {
    if (!open) {
      setInvoice('');
      setPaymentHash('');
    }
  }, [open]);

  useEffect(() => {
    if (!isPaid) return;

    queryClient.invalidateQueries({ queryKey: ['lnbits-wallets'] });
    queryClient.invalidateQueries({ queryKey: ['lnbits-payments'] });
  }, [isPaid, queryClient]);

  const sats = Number(amount);
  const validAmount = Number.isFinite(sats) && sats > 0;

  const generate = async () => {
    if (!validAmount) return;

    const payment = await createInvoice({
      amountSats: sats,
      memo: memo.trim() || 'NostrFeed',
    });

    setInvoice(payment.bolt11);
    setPaymentHash(payment.paymentHash);
  };

  const copy = async (value: string, what: string) => {
    await navigator.clipboard.writeText(value);
    toast({ title: `${what} copied` });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-success/10">
              <ArrowDownLeft className="h-4 w-4 text-success" />
            </div>
            Receive sats
          </DialogTitle>
          <DialogDescription>
            {lightningAddress
              ? 'Share your address for any amount, or create an invoice for a specific one.'
              : 'Create an invoice for a specific amount.'}
          </DialogDescription>
        </DialogHeader>

        {lightningAddress && !invoice && (
          <div className="rounded-lg border border-success/20 bg-success/8 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Your lightning address
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate bg-muted/50 rounded px-2 py-1.5 text-sm font-mono">
                {lightningAddress}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(lightningAddress, 'Address')}
                className="hover:bg-success/10"
              >
                <Copy className="h-4 w-4" />
                <span className="sr-only">Copy lightning address</span>
              </Button>
            </div>
            {/* The address is the wallet's standing code: it works for any
                amount, any number of times, and needs nothing created first.
                An invoice QR only appears once one has been made, which is no
                help to someone holding out a phone to be paid */}
            <QrCode
              value={`lightning:${lightningAddress}`}
              label={`QR code for the lightning address ${lightningAddress}`}
              size={176}
              className="mt-3"
            />

            <p className="mt-3 text-center text-xs text-muted-foreground">
              Scan or copy. Anyone can send to this, no invoice needed.
            </p>
          </div>
        )}

        {invoice ? (
          <div className="space-y-5">
            <div className="flex justify-center p-4 bg-gradient-to-br from-muted/50 to-muted/30 rounded-xl">
              <QrCode value={`lightning:${invoice}`} label="Invoice QR code" />
            </div>

            <div
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium',
                isPaid
                  ? 'border-success/30 bg-success/10 text-success-strong'
                  : 'border-muted bg-muted/40 text-muted-foreground'
              )}
              role="status"
            >
              {isPaid ? (
                <>
                  <Check className="h-5 w-5" />
                  <span>Received {sats.toLocaleString()} sats</span>
                </>
              ) : (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Waiting for {sats.toLocaleString()} sats…</span>
                </>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Invoice
              </p>
              <div className="flex gap-2">
                <Input
                  value={invoice}
                  readOnly
                  onClick={(event) => event.currentTarget.select()}
                  className="font-mono text-xs bg-muted/50 flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copy(invoice, 'Invoice')}
                  className="shrink-0"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <Button
              variant="default"
              className="w-full"
              asChild
            >
              <a href={`lightning:${invoice}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open in wallet
              </a>
            </Button>

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setInvoice('');
                setPaymentHash('');
              }}
            >
              {isPaid ? 'Receive again' : 'Change amount'}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="receive-amount" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Amount
              </Label>
              <Input
                id="receive-amount"
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
                    {(preset / 1000).toLocaleString()}k
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receive-memo" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Description (optional)
              </Label>
              <Input
                id="receive-memo"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="Coffee, donation, etc."
              />
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={generate}
              disabled={!validAmount || isCreatingInvoice}
            >
              {isCreatingInvoice && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create invoice
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
