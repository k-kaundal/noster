import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  QrCode as QrIcon,
  Undo2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QrCode } from '@/components/wallet/QrCode';
import { useToast } from '@/hooks/useToast';
import { mintHost } from '@/lib/cashu';
import type { TokenState } from '@/lib/cashu';
import type { SentToken } from '@/hooks/useSentTokens';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

/**
 * Past this length a QR is too dense to read off a screen with a phone.
 *
 * A token's length grows with the number of proofs behind it, so a large or
 * awkwardly-denominated amount can exceed it. Copying always works, which is
 * why the code is the optional half and the string is not.
 */
const QR_LIMIT = 1200;

const STATE_STYLE: Record<TokenState, { label: string; className: string }> = {
  unclaimed: {
    label: 'Not claimed yet',
    className: 'bg-warning/15 text-warning-strong',
  },
  pending: {
    label: 'Being claimed',
    className: 'bg-warning/15 text-warning-strong',
  },
  redeemed: {
    label: 'Claimed',
    className: 'bg-success/15 text-success-strong',
  },
  unknown: {
    label: 'Mint unreachable',
    className: 'bg-muted text-muted-foreground',
  },
};

/**
 * A token, as a thing you can hand over.
 *
 * Presented as the object it is rather than as a row in a ledger: the amount
 * is the face of it, the note written on it is shown, and the code and the
 * string are both one tap away. The state is the part that did not exist
 * before — a token is a bearer string, and the sender otherwise has no way to
 * know whether the person they sent it to ever took it.
 */
export function TokenCard({
  sent,
  onReclaim,
  className,
}: {
  sent: SentToken;
  onReclaim?: (sent: SentToken) => Promise<void>;
  className?: string;
}) {
  const { toast } = useToast();
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isReclaiming, setReclaiming] = useState(false);

  const state = STATE_STYLE[sent.state];
  const claimed = sent.state === 'redeemed' || sent.state === 'pending';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sent.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Select the token and copy it manually.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border',
        // A claimed token is history; a live one still holds money
        claimed ? 'opacity-70' : 'border-primary/30',
        className
      )}
    >
      {/*
        The face of the card. Coloured while the money is still out there and
        flat once it has been taken, so a glance down the list separates the
        two without reading a word.
      */}
      <div
        className={cn(
          'relative px-4 py-5',
          claimed
            ? 'bg-muted/40'
            : 'bg-gradient-to-br from-primary/15 via-primary/5 to-transparent'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-3xl font-bold tracking-tight tabular-nums">
              {sent.amountSats.toLocaleString()}
              <span className="ml-1.5 text-base font-normal text-muted-foreground">
                sats
              </span>
            </p>

            {sent.memo && (
              <p className="mt-1 line-clamp-2 text-sm italic text-muted-foreground">
                “{sent.memo}”
              </p>
            )}
          </div>

          <Badge className={cn('shrink-0 gap-1', state.className)} variant="secondary">
            {sent.isChecking && <Loader2 className="h-3 w-3 animate-spin" />}
            {state.label}
          </Badge>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {mintHost(sent.mint)} · cut {relativeTime(sent.createdAt * 1000)}
        </p>
      </div>

      <div className="space-y-3 border-t p-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5"
            onClick={copy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success-strong" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? 'Copied' : 'Copy token'}
          </Button>

          {sent.token.length <= QR_LIMIT && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowQr((open) => !open)}
              aria-expanded={showQr}
            >
              <QrIcon className="h-3.5 w-3.5" />
              QR
              {showQr ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>
          )}

          {/*
            Only while it is still out there. The proofs are this wallet's to
            spend until somebody swaps them, so taking back a token nobody
            collected is just redeeming your own — and the mint refuses it
            cleanly if they got there first.
          */}
          {onReclaim && sent.state === 'unclaimed' && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              disabled={isReclaiming}
              onClick={async () => {
                setReclaiming(true);
                await onReclaim(sent);
                setReclaiming(false);
              }}
            >
              {isReclaiming ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Undo2 className="h-3.5 w-3.5" />
              )}
              Take back
            </Button>
          )}
        </div>

        {showQr && (
          <div className="flex justify-center rounded-lg border bg-background p-3">
            <QrCode
              value={sent.token}
              label={`QR code for a ${sent.amountSats} sat token`}
              size={200}
            />
          </div>
        )}

        {sent.state === 'unclaimed' && (
          <p className="text-xs text-muted-foreground">
            These sats have left your balance and are in this string. Anyone
            holding it can claim it.
          </p>
        )}
      </div>
    </div>
  );
}
