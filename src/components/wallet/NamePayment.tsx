import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, Wallet, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QrCode } from '@/components/wallet/QrCode';
import { usePayAnyWallet } from '@/hooks/usePayAnyWallet';
import { useLaWallet, usePaymentVerification, type NamePrice } from '@/hooks/useLaWallet';
import { laWalletAddress } from '@/lib/lawallet';

/**
 * Paying for a name, from whichever wallet somebody actually has.
 *
 * This used to be a single button that spent from the default wallet, and it
 * assumed the only way to pay was from inside this app — because claiming the
 * name needs the payment's preimage and an outside wallet never hands one
 * back to a web page.
 *
 * The service publishes a LUD-21 verify URL on every invoice, which is the way
 * out of that: it will confirm the payment and return the proof itself. So an
 * invoice can go to a phone, a hardware wallet, anywhere, and the name still
 * gets claimed — the page just has to keep asking.
 */
export function NamePayment({
  price,
  domain,
  onDone,
  onCancel,
}: {
  price: NamePrice;
  domain: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { buy, isBuying, settle, isSettling } = useLaWallet();
  const { options, preferredFor } = usePayAnyWallet();

  const [payingId, setPayingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const wallets = options.filter((option) => option.method !== 'manual');
  const preferred = preferredFor(price.amountSats ?? 0);
  const busy = isBuying || isSettling;

  const { invoice } = price;

  /**
   * Only worth watching while there is somewhere to watch, and only until it
   * settles. A wallet paid from here returns its own proof and never needs
   * this.
   */
  const verification = usePaymentVerification(invoice.verify, !busy);

  /**
   * Fires once, and once only.
   *
   * The poll keeps returning `settled` after the first success, and every
   * re-render would otherwise start another claim for a name already bought.
   */
  const claimed = useRef(false);

  useEffect(() => {
    const proof = verification.data?.preimage;
    if (!proof || claimed.current) return;

    claimed.current = true;

    void settle({ quote: price, preimage: proof })
      .then(onDone)
      // The toast says what happened; the invoice stays on screen so the
      // payment is not lost along with the attempt
      .catch(() => {
        claimed.current = false;
      });
  }, [verification.data, settle, price, onDone]);

  const amount =
    price.amountSats === null
      ? 'has to be paid for'
      : `costs ${price.amountSats.toLocaleString()} sats`;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <div>
        <p className="text-sm">
          <span className="font-medium">
            {laWalletAddress(price.username, domain)}
          </span>{' '}
          <span className="text-muted-foreground">{amount}.</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Paid once. The name is yours afterwards and is never reissued to
          anybody else.
        </p>
      </div>

      {/*
        Settling is the step after the money moves, so it gets its own line
        rather than a spinner on a button — somebody watching this needs to
        know the payment landed even if the claim is still going.
      */}
      {isSettling ? (
        <p className="flex items-center gap-2 rounded-md bg-success/10 p-2.5 text-xs text-success-strong">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          Payment received — claiming the name…
        </p>
      ) : (
        verification.data?.settled && (
          <p className="flex items-center gap-2 rounded-md bg-success/10 p-2.5 text-xs text-success-strong">
            <Check className="h-3.5 w-3.5 shrink-0" />
            Payment received.
          </p>
        )
      )}

      {wallets.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pay from
          </p>

          {wallets.map((option) => (
            <Button
              key={option.id}
              variant={option.id === preferred.id ? 'default' : 'outline'}
              size="sm"
              className="h-auto w-full justify-start py-2"
              disabled={busy || !!option.unavailable}
              onClick={() => {
                setPayingId(option.id);
                void buy({ quote: price, optionId: option.id })
                  .then(onDone)
                  .catch(() => {})
                  .finally(() => setPayingId(null));
              }}
            >
              {payingId === option.id ? (
                <Loader2 className="mr-2.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <Zap className="mr-2.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-xs font-medium">
                  {option.label}
                </span>
                {(option.unavailable || option.detail) && (
                  <span className="block truncate text-[0.7rem] opacity-70">
                    {option.unavailable || option.detail}
                  </span>
                )}
              </span>
            </Button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {wallets.length > 0 ? 'Or pay from anywhere' : 'Pay from any wallet'}
        </p>

        <div className="flex justify-center rounded-lg bg-background p-3">
          {/*
            Upper-cased because BOLT11 is case-insensitive and an all-caps
            string encodes in the QR alphanumeric mode, which produces a
            noticeably less dense code for the same invoice.
          */}
          <QrCode
            value={invoice.pr.toUpperCase()}
            label={`Lightning invoice for ${laWalletAddress(price.username, domain)}`}
            size={168}
          />
        </div>

        <div className="flex gap-1.5">
          <Input
            value={invoice.pr}
            readOnly
            onClick={(event) => event.currentTarget.select()}
            aria-label="Lightning invoice"
            className="min-w-0 flex-1 bg-background font-mono text-xs"
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label="Copy invoice"
            onClick={async () => {
              await navigator.clipboard.writeText(invoice.pr);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? (
              <Check className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label="Open in a wallet app"
            asChild
          >
            <a href={`lightning:${invoice.pr}`}>
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>

        {invoice.verify ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            Waiting for payment — the name is claimed automatically once it
            arrives.
          </p>
        ) : (
          /*
            No verify URL means no way to prove an outside payment, and paying
            anyway would spend the money for nothing. Said plainly rather than
            leaving the QR up as an offer that cannot be honoured.
          */
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Wallet className="h-3 w-3 shrink-0" />
            This invoice cannot be verified automatically. Pay from a wallet
            above so the name can be claimed.
          </p>
        )}
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="w-full"
        disabled={busy}
        onClick={onCancel}
      >
        Not now
      </Button>
    </div>
  );
}
