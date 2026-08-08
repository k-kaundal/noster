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
  const { requestInvoice, confirmPaid, isZapping, resetInvoice } = useZaps(
    target,
    onDone
  );

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

  const start = async () => {
    if (!valid) return;
    setPrepared(await requestInvoice(sats, comment));
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
    <div className="space-y-4">
      <ToggleGroup
        type="single"
        value={String(amount)}
        onValueChange={(value) => value && setAmount(parseInt(value, 10))}
        className="grid grid-cols-5 gap-1"
      >
        {PRESETS.map(({ amount: preset, icon: Icon }) => (
          <ToggleGroupItem
            key={preset}
            value={String(preset)}
            className="flex h-auto min-w-0 flex-col px-1 py-2 text-xs"
          >
            <Icon className="mb-1 h-4 w-4" />
            <span className="truncate">{formatSats(preset)}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min={1}
        placeholder="Custom amount in sats"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />

      <Textarea
        placeholder="Say something (optional)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        className="resize-none"
        rows={2}
      />

      <Button onClick={start} disabled={!valid || isZapping} className="w-full">
        {isZapping ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Zap className="mr-2 h-4 w-4" />
        )}
        {isZapping
          ? 'Asking their wallet…'
          : `Zap ${valid ? formatSats(sats) : 0} sats`}
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
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <span className="ml-auto text-sm font-medium tabular">
          {formatSats(invoice.amountSats)} sats
        </span>
      </div>

      <QrCode
        value={invoice.bolt11.toUpperCase()}
        label="Lightning invoice QR code"
        size={200}
      />

      {wallets.length > 0 ? (
        <div className="space-y-2">
          {wallets.map((option) => {
            const short =
              option.method === 'nostrfeed' &&
              balanceSats < invoice.amountSats;

            return (
              <Button
                key={option.id}
                variant={option.id === preferred.id ? 'default' : 'outline'}
                className="h-auto w-full justify-start py-2.5"
                disabled={isPaying || short}
                onClick={() => run(option)}
              >
                {payingId === option.id ? (
                  <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium">
                    {option.label}
                  </span>
                  {(short || option.detail) && (
                    <span className="block truncate text-xs opacity-70">
                      {short ? 'Not enough sats' : option.detail}
                    </span>
                  )}
                </span>
              </Button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
          No wallet connected here. Scan the code, or copy the invoice and pay
          it anywhere.
        </p>
      )}

      <div className="flex gap-2">
        <Input
          value={invoice.bolt11}
          readOnly
          onClick={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 font-mono text-xs"
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
          aria-label="Open in a lightning wallet"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      {!invoice.publishesReceipt && (
        <p className="text-xs text-muted-foreground">
          Their server doesn't publish zap receipts, so this will reach them but
          won't appear on the note.
        </p>
      )}
    </div>
  );
}

export default ZapDialog;
