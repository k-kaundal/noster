import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Rocket,
  Sparkle,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { QrCode } from '@/components/wallet/QrCode';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePayAnyWallet, type PayOption } from '@/hooks/usePayAnyWallet';
import { useToast } from '@/hooks/useToast';
import { useZaps, type ZapInvoice } from '@/hooks/useZaps';
import { genUserName } from '@/lib/genUserName';
import { formatSats } from '@/lib/zap';
import type { Event } from 'nostr-tools';

interface ZapDialogProps {
  target: Event;
  children?: React.ReactNode;
  className?: string;
  /** Controls the dialog externally; omit to use the built-in trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const PRESETS = [
  { amount: 21, icon: Sparkle },
  { amount: 100, icon: Sparkles },
  { amount: 500, icon: Zap },
  { amount: 1000, icon: Star },
  { amount: 5000, icon: Rocket },
];

/**
 * Sending a zap.
 *
 * Two steps, deliberately: pick an amount, then pick what pays for it. The
 * second step used to not exist — the flow went straight to a browser
 * extension and failed for everyone without one, including people holding a
 * balance in the wallet this app had just given them.
 */
export function ZapDialog({
  target,
  children,
  className,
  open: controlledOpen,
  onOpenChange,
}: ZapDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  const { user } = useCurrentUser();
  const { data: author } = useAuthor(target.pubkey);
  const isMobile = useIsMobile();

  const recipient =
    author?.metadata?.display_name ||
    author?.metadata?.name ||
    genUserName(target.pubkey);

  // Nothing to offer when there is nobody to pay, or when it is your own note
  const zappable = !!author?.metadata?.lud16 || !!author?.metadata?.lud06;
  if (!user || user.pubkey === target.pubkey || !zappable) return null;

  const title = `Zap ${recipient}`;
  const description = 'A zap is a real Bitcoin payment, signed by you.';

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        {children && (
          <DrawerTrigger asChild>
            <div className={className}>{children}</div>
          </DrawerTrigger>
        )}
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            <ZapFlow target={target} open={open} onDone={() => setOpen(false)} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && (
        <DialogTrigger asChild>
          <div className={className}>{children}</div>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ZapFlow target={target} open={open} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ZapFlow({
  target,
  open,
  onDone,
}: {
  target: Event;
  open: boolean;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const { requestInvoice, confirmPaid, isZapping, resetInvoice, splits, resolveSplit } =
    useZaps(target, onDone);

  const [amount, setAmount] = useState<number | string>(100);
  const [comment, setComment] = useState('');
  const [prepared, setPrepared] = useState<ZapInvoice | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A fresh dialog should not open on the last zap's invoice
  useEffect(() => {
    if (!open) {
      setPrepared(null);
      setAmount(100);
      setComment('');
      resetInvoice();
    }
  }, [open, resetInvoice]);

  const sats = typeof amount === 'string' ? parseInt(amount, 10) : amount;
  const valid = Number.isFinite(sats) && sats > 0;

  const shares = valid ? resolveSplit(sats) : [];

  const start = async () => {
    if (!valid) return;

    /**
     * NIP-57 Appendix G: an event can route its zaps to people other than its
     * author. Each share is its own invoice, so they are paid one at a time —
     * the first is prepared here and the rest follow as each is settled.
     *
     * The alternative, ignoring the tags, does not fail visibly. It pays the
     * author the whole amount and everybody the event named gets nothing.
     */
    const first = shares[0];

    setPrepared(
      first
        ? await requestInvoice(
            Math.round(first.amountMsat / 1000),
            comment,
            { pubkey: first.pubkey }
          )
        : await requestInvoice(sats, comment)
    );
  };

  if (prepared) {
    return (
      <PayStep
        invoice={prepared}
        recipientNote={comment}
        onBack={() => {
          setPrepared(null);
          resetInvoice();
        }}
        onPaid={() => {
          confirmPaid();
          toast({
            title: 'Zap sent',
            description: prepared.publishesReceipt
              ? `${formatSats(prepared.amountSats)} sats on their way.`
              : `${formatSats(prepared.amountSats)} sats sent. Their server doesn't publish zap receipts, so it won't show on the note.`,
          });
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/*
        Shown before the amount, because it changes who is being paid. A note
        with `zap` tags does not pay its author at all, and finding that out
        afterwards is finding out too late.
      */}
      {splits.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-dashed p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Split between
          </p>
          {shares.length ? (
            shares.map((share) => (
              <SplitRow
                key={share.pubkey}
                pubkey={share.pubkey}
                sats={Math.round(share.amountMsat / 1000)}
                percent={share.percent}
              />
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              Enter an amount to see how it divides.
            </p>
          )}
          {shares.length > 1 && (
            <p className="pt-1 text-xs text-muted-foreground">
              Each share is a separate payment.
            </p>
          )}
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Amount
        </p>
        <ToggleGroup
          type="single"
          value={String(amount)}
          onValueChange={(value) => value && setAmount(parseInt(value, 10))}
          className="grid grid-cols-5 gap-1.5"
        >
          {PRESETS.map(({ amount: preset, icon: Icon }) => (
            <ToggleGroupItem
              key={preset}
              value={String(preset)}
              className="flex h-auto min-w-0 flex-col rounded-lg px-2 py-2.5 text-xs transition-all hover:bg-muted data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <Icon className="mb-1 h-4 w-4 mx-auto" />
              <span className="truncate text-xs font-medium">{formatSats(preset)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div>
        <div className="relative">
          <Input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="text-lg font-semibold tracking-tight pr-12"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
            sats
          </span>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Message (optional)
        </p>
        <Textarea
          placeholder="Say something nice"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          className="resize-none text-sm"
          rows={2}
        />
      </div>

      <Button onClick={start} disabled={!valid || isZapping} size="lg" className="w-full">
        {isZapping ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Zap className="mr-2 h-4 w-4" />
        )}
        {isZapping
          ? 'Preparing…'
          : `Zap ${valid ? formatSats(sats) : '–'} sats`}
      </Button>
    </div>
  );
}

/**
 * The invoice, and every wallet that could pay it.
 *
 * Listed rather than chosen for them: someone with a custodial balance, a NWC
 * wallet and an extension has a reason for each, and guessing wrong spends
 * from the wrong pocket.
 */
function PayStep({
  invoice,
  onBack,
  onPaid,
}: {
  invoice: ZapInvoice;
  recipientNote: string;
  onBack: () => void;
  onPaid: () => void;
}) {
  const { toast } = useToast();
  const { options, preferredFor, pay, isPaying, balanceSats } =
    usePayAnyWallet();

  const [payingId, setPayingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const preferred = preferredFor(invoice.amountSats);

  const run = async (option: PayOption) => {
    if (option.method === 'manual') return;

    setPayingId(option.id);
    try {
      await pay({
        bolt11: invoice.bolt11,
        optionId: option.id,
        amountSats: invoice.amountSats,
      });
      onPaid();
    } catch (error) {
      toast({
        title: 'Payment failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setPayingId(null);
    }
  };

  const wallets = options.filter((option) => option.method !== 'manual');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Amount</p>
          <p className="text-2xl font-bold tabular text-primary">
            {formatSats(invoice.amountSats)}
          </p>
        </div>
      </div>

      <div className="flex justify-center p-4 bg-gradient-to-br from-muted/50 to-muted/30 rounded-xl">
        <QrCode
          value={invoice.bolt11.toUpperCase()}
          label="Lightning invoice QR code"
          size={180}
        />
      </div>

      {wallets.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Pay from
          </p>
          <div className="space-y-2">
            {wallets.map((option) => {
              const short =
                option.method === 'nostrfeed' &&
                balanceSats < invoice.amountSats;

              return (
                <Button
                  key={option.id}
                  variant={option.id === preferred.id ? 'default' : 'outline'}
                  className="h-auto w-full justify-start rounded-lg py-3 px-4 transition-all"
                  disabled={isPaying || short}
                  onClick={() => run(option)}
                >
                  {payingId === option.id ? (
                    <Loader2 className="mr-3 h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <Zap className="mr-3 h-4 w-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium">
                      {option.label}
                    </span>
                    {(short || option.detail) && (
                      <span className="block truncate text-xs opacity-70">
                        {short ? 'Insufficient balance' : option.detail}
                      </span>
                    )}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 p-4 text-center">
          <p className="text-sm text-muted-foreground">
            No wallet connected. Scan the code above to pay.
          </p>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Invoice
        </p>
        <div className="flex gap-1.5">
          <Input
            value={invoice.bolt11}
            readOnly
            onClick={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 font-mono text-xs bg-muted/50"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={async () => {
              await navigator.clipboard.writeText(invoice.bolt11);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            aria-label="Copy invoice"
            className="shrink-0"
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
            onClick={() => window.open(`lightning:${invoice.bolt11}`, '_blank')}
            aria-label="Open in wallet"
            className="shrink-0"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!invoice.publishesReceipt && (
        <div className="rounded-lg bg-blue-50/50 border border-blue-200/50 p-3 dark:bg-blue-950/20 dark:border-blue-900/30">
          <p className="text-xs text-muted-foreground">
            Their server doesn't publish zap receipts, so this will reach them but won't show on the post.
          </p>
        </div>
      )}
    </div>
  );
}

export default ZapDialog;

/** One recipient of a zap split, named rather than left as a key. */
function SplitRow({
  pubkey,
  sats,
  percent,
}: {
  pubkey: string;
  sats: number;
  percent: number;
}) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;

  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="truncate">
        {metadata?.name || metadata?.display_name || genUserName(pubkey)}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {formatSats(sats)} · {percent}%
      </span>
    </div>
  );
}
