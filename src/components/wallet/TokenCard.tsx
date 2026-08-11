import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Check,
  Copy,
  Download,
  Loader2,
  Maximize2,
  Share2,
  Undo2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { QrCode } from '@/components/wallet/QrCode';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { SITE_NAME } from '@/hooks/useSeo';
import { genUserName } from '@/lib/genUserName';
import { mintHost, type TokenState } from '@/lib/cashu';
import type { SentToken } from '@/hooks/useSentTokens';
import { relativeTime } from '@/lib/time';
import {
  drawTokenCard,
  tokenCardBlob,
  tokenCardFilename,
} from '@/lib/tokenCardImage';
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
 * Laid out as a gift card rather than a ledger row: the platform along the
 * top, the amount as the face of it, the note written on it, who it is from,
 * and the code beside all of it so the whole thing can be shown to a phone at
 * once. What the mint is gets said plainly, because ecash is only honoured by
 * the mint that issued it and a card that omits that leaves the holder unable
 * to redeem it without inspecting the string.
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
  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey);
  const metadata = author.data?.metadata;

  const [copied, setCopied] = useState(false);
  const [isReclaiming, setReclaiming] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  /** Offscreen sources for the exported image. */
  const qrRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const state = STATE_STYLE[sent.state];
  const claimed = sent.state === 'redeemed' || sent.state === 'pending';
  const scannable = sent.token.length <= QR_LIMIT;

  const fromName =
    metadata?.display_name ||
    metadata?.name ||
    (user ? genUserName(user.pubkey) : undefined);

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

  /**
   * Paints the card and hands back a PNG.
   *
   * The QR is lifted from the live canvas rather than re-encoded, so the
   * exported code is the same one on screen — an export that quietly encodes
   * something else would be a picture of money that does not work.
   */
  const buildImage = async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    /**
     * The amount and the note are deliberately not passed. The card is a
     * picture that gets forwarded, and printing the value announces it to
     * everyone it passes on the way — the person scanning it finds out, and
     * nobody else needs to.
     */
    drawTokenCard(canvas, {
      fromName,
      mintHost: mintHost(sent.mint),
      platform: SITE_NAME,
      claimed,
      qr: qrRef.current?.querySelector('canvas') ?? null,
    });

    return await tokenCardBlob(canvas);
  };

  const download = async () => {
    const blob = await buildImage();

    if (!blob) {
      toast({
        title: 'Could not make the image',
        description: 'Copy the token instead — that is the part that matters.',
        variant: 'destructive',
      });
      return;
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = tokenCardFilename();
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const share = async () => {
    const blob = await buildImage();
    if (!blob) return;

    const file = new File([blob], tokenCardFilename(), { type: 'image/png' });

    /**
     * Only offered when the browser will actually take a file. `canShare` is
     * checked with the file in hand because desktop browsers advertise
     * `share` and then refuse attachments.
     */
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] }).catch(() => undefined);
      return;
    }

    await download();
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border shadow-sm',
        claimed ? 'opacity-75' : 'border-primary/25',
        className
      )}
    >
      {/*
        The face. Coloured while the money is still out there and flat once it
        has been taken, so a glance down a list separates the two.
      */}
      <div
        className={cn(
          'relative px-5 py-5',
          claimed
            ? 'bg-muted/40'
            : 'bg-gradient-to-br from-primary/15 via-background to-success/10'
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
                {SITE_NAME}
              </span>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Ecash token
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold tracking-tight tabular-nums">
                {sent.amountSats.toLocaleString()}
              </span>
              <span className="text-base text-muted-foreground">sats</span>
            </div>

            {sent.memo && (
              <p className="line-clamp-2 text-sm italic text-muted-foreground">
                “{sent.memo}”
              </p>
            )}

            <div className="space-y-0.5 pt-1 text-xs text-muted-foreground">
              {fromName && <p className="truncate">from {fromName}</p>}
              <p className="truncate">Issued by {mintHost(sent.mint)}</p>
              <p>cut {relativeTime(sent.createdAt * 1000)}</p>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-2">
            <Badge
              className={cn('gap-1 whitespace-nowrap', state.className)}
              variant="secondary"
            >
              {sent.isChecking && <Loader2 className="h-3 w-3 animate-spin" />}
              {state.label}
            </Badge>

            {/*
              The code lives on the card rather than behind a toggle. Handing
              a token over is showing somebody a screen, and a step in the way
              of that is a step in the way of the whole feature.
            */}
            {scannable && (
              <button
                type="button"
                onClick={() => setZoomed(true)}
                className="group relative rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-black/10 transition-transform hover:scale-105"
                aria-label="Enlarge the QR code"
              >
                <QRCodeCanvas
                  value={sent.token}
                  size={84}
                  level="M"
                  marginSize={0}
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
                <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 opacity-0 transition-opacity group-hover:bg-black/10 group-hover:opacity-100">
                  <Maximize2 className="h-4 w-4 text-black" />
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t p-3">
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

        {scannable && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={share}
            >
              <Share2 className="h-3.5 w-3.5" />
              Share card
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={download}
              aria-label="Download the card as an image"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </>
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

      {sent.state === 'unclaimed' && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          These sats have left your balance and are in this string. Anyone
          holding it can claim it.
        </p>
      )}

      {!scannable && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Too many proofs behind this one to draw a scannable code. Copy the
          token instead.
        </p>
      )}

      {/*
        Offscreen sources for the export: a full-resolution QR to draw in, and
        the canvas the card is painted on. Kept out of the layout rather than
        hidden with `display:none`, which stops some browsers rendering canvas.
      */}
      <div
        ref={qrRef}
        aria-hidden="true"
        className="pointer-events-none fixed -left-[9999px] top-0"
      >
        {scannable && (
          <QRCodeCanvas
            value={sent.token}
            size={512}
            level="M"
            marginSize={0}
            bgColor="#ffffff"
            fgColor="#000000"
          />
        )}
      </div>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed -left-[9999px] top-0"
      />

      <Dialog open={zoomed} onOpenChange={setZoomed}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {sent.amountSats.toLocaleString()} sats
              {sent.memo ? ` · “${sent.memo}”` : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <QrCode
              value={sent.token}
              label={`QR code for a ${sent.amountSats} sat token`}
              size={240}
            />
            <p className="text-center text-xs text-muted-foreground">
              Issued by {mintHost(sent.mint)} · only that mint honours it
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
