import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { QrCode } from '@/components/wallet/QrCode';
import { useNWC } from '@/hooks/useNWCContext';
import { useToast } from '@/hooks/useToast';
import type { NWCConnection } from '@/hooks/useNWC';

/**
 * Send and receive for a wallet somebody connected themselves.
 *
 * These buttons existed only for the custodial wallet here, so a person who
 * connected their own wallet over NWC could watch its balance and nothing
 * else — every payment had to go through ours instead of theirs, which is the
 * opposite of the point of connecting one.
 */
export function ConnectedWalletActions({
  connection,
}: {
  connection: NWCConnection;
}) {
  const [receiving, setReceiving] = useState(false);
  const [sending, setSending] = useState(false);

  return (
    <>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => setReceiving(true)}
        >
          <ArrowDownLeft className="mr-2 h-3.5 w-3.5" />
          Receive
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => setSending(true)}
        >
          <ArrowUpRight className="mr-2 h-3.5 w-3.5" />
          Send
        </Button>
      </div>

      <ReceiveFromWallet
        connection={connection}
        open={receiving}
        onOpenChange={setReceiving}
      />
      <SendFromWallet
        connection={connection}
        open={sending}
        onOpenChange={setSending}
      />
    </>
  );
}

function ReceiveFromWallet({
  connection,
  open,
  onOpenChange,
}: {
  connection: NWCConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { receivePayment } = useNWC();
  const { toast } = useToast();

  const [amount, setAmount] = useState('1000');
  const [memo, setMemo] = useState('');
  const [invoice, setInvoice] = useState('');
  const [busy, setBusy] = useState(false);

  const sats = Number(amount);
  const valid = Number.isFinite(sats) && sats > 0;

  const close = (next: boolean) => {
    if (!next) {
      setInvoice('');
      setBusy(false);
    }
    onOpenChange(next);
  };

  const request = async () => {
    setBusy(true);

    try {
      const { bolt11 } = await receivePayment(connection, sats, memo.trim());
      setInvoice(bolt11);
    } catch (error) {
      toast({
        title: 'Could not get an invoice',
        description:
          error instanceof Error ? error.message : 'Your wallet did not answer.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Receive to {connection.alias || 'your wallet'}</DialogTitle>
          <DialogDescription>
            The invoice is made by your own wallet, so the money lands there
            rather than here.
          </DialogDescription>
        </DialogHeader>

        {invoice ? (
          <div className="space-y-4">
            <QrCode
              value={`lightning:${invoice}`}
              label="QR code for the invoice"
              size={192}
            />

            <div className="flex gap-2">
              <Input
                readOnly
                value={invoice}
                onClick={(event) => event.currentTarget.select()}
                className="flex-1 bg-muted/50 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label="Copy invoice"
                onClick={async () => {
                  await navigator.clipboard.writeText(invoice);
                  toast({ title: 'Invoice copied' });
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>

            {/* No paid-yet indicator: watching for settlement needs a
                subscription this connection may not grant, and a spinner that
                never resolves reads worse than no spinner at all. */}
            <p className="text-xs text-muted-foreground">
              {sats.toLocaleString()} sats. Your wallet will show it once paid.
            </p>

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setInvoice('')}
            >
              Another amount
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nwc-receive-amount">Amount in sats</Label>
              <Input
                id="nwc-receive-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                className="text-xl font-bold tabular-nums"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nwc-receive-memo">What for (optional)</Label>
              <Input
                id="nwc-receive-memo"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="Coffee"
              />
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={!valid || busy}
              onClick={() => void request()}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Make an invoice
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SendFromWallet({
  connection,
  open,
  onOpenChange,
}: {
  connection: NWCConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { sendPayment } = useNWC();
  const { toast } = useToast();

  const [invoice, setInvoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const valid = /^ln(bcrt|bc|tb)/i.test(invoice.trim());

  const close = (next: boolean) => {
    if (!next) {
      setInvoice('');
      setDone(false);
    }
    onOpenChange(next);
  };

  const pay = async () => {
    setBusy(true);

    try {
      await sendPayment(connection, invoice.trim());
      setDone(true);
      toast({ title: 'Paid' });
    } catch (error) {
      toast({
        title: 'Payment failed',
        description:
          error instanceof Error ? error.message : 'Your wallet refused it.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send from {connection.alias || 'your wallet'}</DialogTitle>
          <DialogDescription>
            Paid by the wallet you connected, not by the one here.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <Check className="h-6 w-6 text-success" />
            </div>
            <p className="text-sm text-muted-foreground">
              Your wallet paid it.
            </p>
            <Button variant="outline" className="w-full" onClick={() => close(false)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nwc-send-invoice">Invoice</Label>
              <Textarea
                id="nwc-send-invoice"
                value={invoice}
                onChange={(event) => setInvoice(event.target.value)}
                placeholder="lnbc…"
                rows={4}
                className="font-mono text-xs"
              />
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={!valid || busy}
              onClick={() => void pay()}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Pay it
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
