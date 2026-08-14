import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Check,
  Copy,
  Download,
  Image as ImageIcon,
  Link2,
  Loader2,
  Share2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useReactions } from '@/hooks/useReactions';
import { useReplies } from '@/hooks/useReplies';
import { useReposts } from '@/hooks/useReposts';
import { useZapSummary } from '@/hooks/useZapSummary';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { handleFor } from '@/lib/handle';
import { saveFile } from '@/lib/saveFile';
import { renderShareCard } from '@/lib/shareCard';
import { shareCaption, shareableNote } from '@/lib/shareNote';

interface ShareNoteDialogProps {
  event: NostrEvent;
  url: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Sharing a note somewhere that is not Nostr.
 *
 * A bare link previews as nothing useful — every crawler is handed the same
 * `index.html`, so a note shared to X or Facebook appears as the site's front
 * door whatever was actually shared. Fixing that properly needs a server
 * rendering meta tags per request, which this app does not have.
 *
 * A picture of the note needs nobody's cooperation. It carries the author, the
 * words and the note's own image into any feed that accepts a file, and looks
 * the same everywhere because nothing is re-rendering it. So the card is what
 * this offers first, with the link underneath for the places that only want
 * one.
 */
export function ShareNoteDialog({
  event,
  url,
  open,
  onOpenChange,
}: ShareNoteDialogProps) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const { toast } = useToast();

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);

  /*
   * The same hooks the note's own action row uses, so these are already in the
   * query cache by the time anyone opens this — reading them here costs
   * nothing and the card shows exactly the numbers the post does.
   */
  const { likeCount } = useReactions(event.id);
  const { replyCount } = useReplies(event.id);
  const { repostCount } = useReposts(event.id);
  const zapSummary = useZapSummary(event);

  const stats = useMemo(
    () => ({
      reactions: likeCount,
      replies: replyCount,
      reposts: repostCount,
      zapSats: zapSummary.totalSats,
    }),
    [likeCount, replyCount, repostCount, zapSummary.totalSats]
  );

  const [card, setCard] = useState<{ blob: Blob; preview: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'share' | 'save' | 'copy' | null>(null);
  const [copied, setCopied] = useState(false);

  /*
   * Drawn when the dialog opens rather than with the note. Every note in a
   * feed would otherwise render a canvas, decode two cross-origin images and
   * hold a blob, for a card almost none of them will ever be asked for.
   */
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let objectUrl: string | undefined;

    (async () => {
      try {
        const { text, imageUrl } = shareableNote(event);

        const blob = await renderShareCard({
          displayName,
          handle: handleFor(metadata, event.pubkey),
          avatarUrl: metadata?.picture,
          content: text,
          imageUrl,
          createdAt: event.created_at,
          url,
          stats,
        });

        if (cancelled) return;

        objectUrl = URL.createObjectURL(blob);
        setCard({ blob, preview: objectUrl });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        /*
         * Cleared with it. The preview `src` would otherwise still point at a
         * revoked URL, so reopening the dialog showed a broken image for as
         * long as the redraw took — the skeleton is the honest picture of
         * "being drawn".
         */
        setCard(null);
      }
    };
  }, [open, event, displayName, metadata, url, stats]);

  const filename = `nostrfeed-${event.id.slice(0, 8)}.png`;

  // Memoised because `navigator.canShare` and the share callback both take it:
  // a new File each render would re-run them for no reason
  const file = useMemo(
    () =>
      card ? new File([card.blob], filename, { type: 'image/png' }) : null,
    [card, filename]
  );

  const canShareFile =
    !!file &&
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] });

  const shareImage = useCallback(async () => {
    if (!file) return;
    setBusy('share');

    try {
      await navigator.share({
        files: [file],
        text: shareCaption(displayName, url),
      });
    } catch (error) {
      // A dismissed sheet is a decision, not a failure
      if ((error as Error)?.name !== 'AbortError') {
        toast({ title: 'Could not open the share sheet', variant: 'destructive' });
      }
    } finally {
      setBusy(null);
    }
  }, [displayName, file, toast, url]);

  const saveImage = useCallback(async () => {
    if (!card) return;
    setBusy('save');

    const outcome = await saveFile(card.blob, filename, 'image/png');

    setBusy(null);

    if (outcome === 'unsupported') {
      toast({
        title: 'Could not save the image',
        description: 'Press and hold the picture above to save it instead.',
        variant: 'destructive',
      });
    } else if (outcome === 'saved') {
      toast({ title: 'Image saved' });
    }
  }, [card, filename, toast]);

  const copyImage = useCallback(async () => {
    if (!card) return;
    setBusy('copy');

    try {
      /*
       * The blob goes in as `image/png` because that is the only type every
       * clipboard implementation accepts. Written from the blob we already
       * have rather than re-encoded, so the paste is the same picture as the
       * preview.
       */
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': card.blob }),
      ]);

      toast({
        title: 'Image copied',
        description: 'Paste it into a post anywhere.',
      });
    } catch {
      toast({
        title: 'Could not copy the image',
        description: 'Save it instead, then attach it.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }, [card, toast]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Could not copy the link', variant: 'destructive' });
    }
  }, [toast, url]);

  const canCopyImage =
    typeof window !== 'undefined' &&
    typeof ClipboardItem !== 'undefined' &&
    !!navigator.clipboard?.write;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share this note</DialogTitle>
          <DialogDescription>
            The picture carries the whole note, so it reads properly wherever
            you post it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border">
            {card ? (
              <img
                src={card.preview}
                alt={`Note by ${displayName}, as a picture`}
                className="w-full"
              />
            ) : failed ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Couldn't draw the picture. The link below still works.
              </p>
            ) : (
              <Skeleton className="h-56 w-full rounded-none" />
            )}
          </div>

          {card && (
            <div className="flex flex-wrap gap-2">
              {/*
                The native sheet is the whole feature on a phone: it reaches
                X, Facebook, WhatsApp, Signal and everything else with the
                image already attached, which no web intent can do.
              */}
              {canShareFile && (
                <Button
                  onClick={() => void shareImage()}
                  disabled={busy !== null}
                  className="flex-1"
                >
                  {busy === 'share' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="mr-2 h-4 w-4" />
                  )}
                  Share image
                </Button>
              )}

              {canCopyImage && (
                <Button
                  variant={canShareFile ? 'outline' : 'default'}
                  onClick={() => void copyImage()}
                  disabled={busy !== null}
                  className="flex-1"
                >
                  {busy === 'copy' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="mr-2 h-4 w-4" />
                  )}
                  Copy image
                </Button>
              )}

              <Button
                variant="outline"
                onClick={() => void saveImage()}
                disabled={busy !== null}
                className="flex-1"
              >
                {busy === 'save' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Save
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {url.replace(/^https?:\/\//, '')}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copyLink()}
                className="h-8 shrink-0"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success-strong" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5">{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>

            {/*
              Said plainly, because it is the difference between the two
              things on this screen and somebody will otherwise wonder why
              their link posted blank.
            */}
            <p className="text-xs text-muted-foreground">
              A bare link can't preview a note — post the picture with it and
              people see what you shared.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
