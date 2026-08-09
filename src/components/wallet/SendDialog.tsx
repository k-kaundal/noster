import { useState } from 'react';
import { ArrowUpRight, Loader2, Wallet } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useToast } from '@/hooks/useToast';
import { parsePaymentTarget, readInvoiceSats } from '@/lib/paymentInput';

interface SendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balanceSats: number;
}

/**
 * Paying out of the NostrFeed wallet.
 *
 * One box for every form of destination, because the string says which it is.
 * An invoice that already names its amount hides the amount field entirely —
 * showing an editable number that cannot change anything invites the belief
 * that it can.
 */
export function SendDialog({ open, onOpenChange, balanceSats }: SendDialogProps) {
  const { payInvoice, payLnurl, isPaying } = useLnbitsWallet();
  const { toast } = useToast();

  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');

  const target = parsePaymentTarget(destination);
  const invoiceSats =
    target.kind === 'invoice' ? readInvoiceSats(target.value) : null;

  // Only an amountless invoice, an address or an LNURL needs a number typed
  const needsAmount =
    (target.kind === 'invoice' && invoiceSats === null) ||
    target.kind === 'address' ||
    target.kind === 'lnurl';

  const typedSats = Number(amount);
  const sats = invoiceSats ?? (Number.isFinite(typedSats) ? typedSats : 0);
  const overBalance = sats > balanceSats;

  const ready =
    (target.kind === 'invoice' || target.kind === 'address' || target.kind === 'lnurl') &&
    (!needsAmount || sats > 0) &&
    !overBalance;

  const send = async () => {
    if (!ready) return;

    try {
      if (target.kind === 'invoice') {
        await payInvoice(target.value);
      } else {
        await payLnurl({
          lnurl: target.value,
          amountSats: sats,
          comment: comment.trim() || undefined,
        });
      }

      toast({
        title: 'Payment sent',
        description: `${sats.toLocaleString()} sats on their way.`,
      });

      setDestination('');
      setAmount('');
      setComment('');
      onOpenChange(false);
    } catch {
      // useLnbitsWallet already reports the reason
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
              <ArrowUpRight className="h-4 w-4" />
            </div>
            Send sats
          </DialogTitle>
          <DialogDescription>
            Enter an invoice, lightning address, or LNURL to pay.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="send-to" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recipient
            </Label>
            <Textarea
              id="send-to"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="name@domain.com or lnbc… or lnurl…"
              className="min-h-[72px] resize-none break-all font-mono text-xs bg-muted/50"
            />
            <TargetHint kind={target.kind} invoiceSats={invoiceSats} />
          </div>

          {needsAmount && (
            <div className="space-y-2">
              <Label htmlFor="send-amount" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Amount
              </Label>
              <Input
                id="send-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                className="text-xl font-bold tabular-nums"
              />
            </div>
          )}

          {(target.kind === 'address' || target.kind === 'lnurl') && (
            <div className="space-y-2">
              <Label htmlFor="send-comment" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Message (optional)
              </Label>
              <Input
                id="send-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Say thanks or add a note"
              />
            </div>
          )}

          <div className="rounded-lg bg-muted/50 p-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              Balance
            </span>
            <span className="tabular-nums font-semibold">
              {balanceSats.toLocaleString()} sats
            </span>
          </div>

          {overBalance && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">
                That's more than your balance. Send less or add sats.
              </p>
            </div>
          )}

          <Button size="lg" className="w-full" onClick={send} disabled={!ready || isPaying}>
            {isPaying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {sats > 0 ? `Send ${sats.toLocaleString()} sats` : 'Send'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TargetHint({
  kind,
  invoiceSats,
}: {
  kind: ReturnType<typeof parsePaymentTarget>['kind'];
  invoiceSats: number | null;
}) {
  if (kind === 'empty') return null;

  if (kind === 'unknown') {
    return (
      <p className="text-xs text-destructive">
        That isn't an invoice, a lightning address or an LNURL.
      </p>
    );
  }

  const label =
    kind === 'invoice'
      ? invoiceSats === null
        ? 'Invoice — no amount set, so name one below'
        : `Invoice for ${invoiceSats.toLocaleString()} sats`
      : kind === 'address'
        ? 'Lightning address'
        : 'LNURL';

  return <p className="text-xs text-muted-foreground">{label}</p>;
}
