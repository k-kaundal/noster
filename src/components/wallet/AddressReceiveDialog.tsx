import { useState } from 'react';
import { ArrowDownLeft, Copy, Loader2 } from 'lucide-react';
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
import { useToast } from '@/hooks/useToast';
import {
  fetchInvoice,
  fetchPayMetadata,
  validateAmount,
  type LnurlPayMetadata,
} from '@/lib/lnurlPay';
import { lightningAddressUrl } from '@/lib/zapRequest';

/**
 * An invoice for money to arrive at one of somebody's addresses.
 *
 * Asked of the address itself over LNURL-pay rather than of whichever backend
 * issued it, which is what makes one dialog enough: the LNbits addresses and
 * anything linked from elsewhere all answer the same two requests. It also means the invoice comes from the machine that will
 * actually be paid, so it cannot disagree with where the money lands.
 *
 * Handing somebody an address is already enough to be paid. This is for the
 * times a figure has to be fixed in advance — an amount agreed, a QR to hold
 * up — which an address alone cannot express.
 */
export function AddressReceiveDialog({
  address,
  open,
  onOpenChange,
}: {
  address: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();

  const [amount, setAmount] = useState('1000');
  const [memo, setMemo] = useState('');
  const [invoice, setInvoice] = useState('');
  const [metadata, setMetadata] = useState<LnurlPayMetadata | null>(null);
  const [busy, setBusy] = useState(false);

  const sats = Number(amount);

  /**
   * Checked against the address's own limits once they are known. A link that
   * takes 1 to 10,000,000 sats and a link that takes exactly 21 both look the
   * same until asked, and being refused after pressing the button teaches
   * nothing about which one this is.
   */
  const problem =
    metadata && Number.isFinite(sats) ? validateAmount(sats, metadata) : null;

  const close = (next: boolean) => {
    if (!next) {
      setInvoice('');
      setBusy(false);
    }
    onOpenChange(next);
  };

  const request = async () => {
    const url = lightningAddressUrl(address);
    if (!url) {
      toast({
        title: "That address can't be resolved",
        description: `${address} is not a valid lightning address.`,
        variant: 'destructive',
      });
      return;
    }

    setBusy(true);

    try {
      const offer = metadata ?? (await fetchPayMetadata(url));
      setMetadata(offer);

      const wrong = validateAmount(sats, offer);
      if (wrong) {
        toast({ title: wrong, variant: 'destructive' });
        return;
      }

      setInvoice(await fetchInvoice(offer, sats * 1000, memo.trim()));
    } catch (error) {
      toast({
        title: 'Could not make an invoice',
        description:
          error instanceof Error
            ? error.message
            : `${address} did not answer.`,
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
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
              <ArrowDownLeft className="h-4 w-4 text-primary" />
            </div>
            Receive at {address}
          </DialogTitle>
          <DialogDescription>
            Wherever this address points is where the money lands.
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

            {/* Nothing here polls for settlement. This app is not necessarily
                on the receiving end — the address may forward to a wallet it
                cannot see — so the honest thing is to say where to look. */}
            <p className="text-xs text-muted-foreground">
              {sats.toLocaleString()} sats. It arrives wherever {address}{' '}
              points, so check there.
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
              <Label htmlFor="address-receive-amount">Amount in sats</Label>
              <Input
                id="address-receive-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                className="text-xl font-bold tabular-nums"
              />
              {problem && <p className="text-xs text-destructive">{problem}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="address-receive-memo">What for (optional)</Label>
              <Input
                id="address-receive-memo"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="Coffee"
                disabled={metadata?.commentAllowed === 0}
              />
              {metadata?.commentAllowed === 0 && (
                <p className="text-xs text-muted-foreground">
                  This address doesn't carry a note.
                </p>
              )}
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={busy || !!problem || !Number.isFinite(sats) || sats <= 0}
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
