import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Copy, ExternalLink, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FiatValue } from '@/components/FiatValue';
import { QrCode } from '@/components/wallet/QrCode';
import { useInvoiceStatus } from '@/hooks/useLnbitsWallet';
import { useToast } from '@/hooks/useToast';
import { minutesLeft, type WalletPayment } from '@/lib/payments';
import { formatSats } from '@/lib/zap';

/**
 * An invoice somebody was asked to pay, brought back up.
 *
 * A request used to exist only in the dialog that created it: close that, and
 * the invoice was gone — visible in the history as a dimmed row with no way to
 * copy it, show it again, or find out whether it had been paid. So asking
 * somebody for money and then switching screens meant asking again.
 *
 * Live rather than a snapshot. It polls while it is open, because the one
 * state a wallet must never sit in is showing an invoice that has already been
 * paid.
 */
export function PaymentRequestDialog({
  request,
  open,
  onOpenChange,
}: {
  request: WalletPayment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { isPaid } = useInvoiceStatus(
    open && request ? request.hash : undefined
  );

  useEffect(() => {
    if (!isPaid) return;

    queryClient.invalidateQueries({ queryKey: ['lnbits-wallets'] });
    queryClient.invalidateQueries({ queryKey: ['lnbits-payments'] });
  }, [isPaid, queryClient]);

  if (!request) return null;

  const left = minutesLeft(request);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-warning/15">
              <Clock className="h-4 w-4 text-warning-strong" />
            </div>
            {isPaid ? 'Paid' : 'Payment request'}
          </DialogTitle>
          <DialogDescription>
            {isPaid
              ? 'This one has been paid — your balance is up to date.'
              : request.memo || 'Waiting for this to be paid.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-center">
            <p className="text-2xl font-semibold tabular">
              {formatSats(request.sats)}
            </p>
            <FiatValue
              sats={request.sats}
              className="mt-1 block text-sm text-muted-foreground"
            />
          </div>

          {isPaid ? (
            <p className="flex items-center justify-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success-strong">
              <Check className="h-4 w-4 shrink-0" />
              Received {formatSats(request.sats)}
            </p>
          ) : (
            <>
              <QrCode
                value={`lightning:${request.bolt11}`}
                label="QR code for this payment request"
                size={192}
              />

              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    await navigator.clipboard.writeText(request.bolt11);
                    toast({ title: 'Invoice copied' });
                  }}
                >
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy invoice
                </Button>

                <Button variant="outline" asChild className="w-full">
                  <a href={`lightning:${request.bolt11}`}>
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    Open in a wallet
                  </a>
                </Button>
              </div>

              <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/50 p-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  {/* The deadline said plainly. An invoice that has quietly
                      died looks identical to one still waiting, and the person
                      holding it finds out by having their payment refused. */}
                  {left === null
                    ? 'Waiting for payment'
                    : left > 0
                      ? `Waiting — expires in ${left} ${left === 1 ? 'minute' : 'minutes'}`
                      : 'This has expired. Ask again with a new invoice.'}
                </p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
