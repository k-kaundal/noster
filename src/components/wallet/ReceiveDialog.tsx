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
            <ArrowDownLeft className="h-4 w-4 text-success" />
            Receive sats
          </DialogTitle>
          <DialogDescription>
            {lightningAddress
              ? 'Share your address for any amount, or make an invoice for a specific one.'
              : 'Make an invoice for a specific amount.'}
          </DialogDescription>
        </DialogHeader>

        {lightningAddress && !invoice && (
          <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3">
            <span className="min-w-0 flex-1 truncate font-medium">
              {lightningAddress}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copy(lightningAddress, 'Address')}
            >
              <Copy className="h-3.5 w-3.5" />
              <span className="sr-only">Copy lightning address</span>
            </Button>
          </div>
        )}

        {invoice ? (
          <div className="space-y-4">
            <QrCode value={`lightning:${invoice}`} label="Invoice QR code" />

            <div
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border p-2.5 text-sm',
                isPaid
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'text-muted-foreground'
              )}
              role="status"
            >
              {isPaid ? (
                <>
                  <Check className="h-4 w-4" />
                  Paid — {sats.toLocaleString()} sats received
                </>
              ) : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Waiting for {sats.toLocaleString()} sats
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => copy(invoice, 'Invoice')}>
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
              <Button variant="outline" asChild>
                <a href={`lightning:${invoice}`}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open wallet
                </a>
              </Button>
            </div>

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setInvoice('');
                setPaymentHash('');
              }}
            >
              {isPaid ? 'Receive again' : 'Change the amount'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="receive-amount">Amount in sats</Label>
              <Input
                id="receive-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                className="text-lg tabular-nums"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant={Number(amount) === preset ? 'default' : 'outline'}
                    onClick={() => setAmount(String(preset))}
                  >
                    {preset.toLocaleString()}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="receive-memo">What's it for (optional)</Label>
              <Input
                id="receive-memo"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="Coffee"
              />
            </div>

            <Button
              className="w-full"
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
