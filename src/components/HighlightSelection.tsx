import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Highlighter, MessageSquareQuote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCreateHighlight } from '@/hooks/useHighlights';
import { normaliseSelection, trimContext } from '@/lib/nip84';
import { cn } from '@/lib/utils';

interface Picked {
  text: string;
  context?: string;
  /** Viewport coordinates of the selection, for placing the button. */
  x: number;
  y: number;
}

export interface HighlightSource {
  eventId?: string;
  address?: string;
  url?: string;
  /** The author of the material, credited on the highlight. */
  authorPubkey?: string;
}

/**
 * Wraps readable content so selecting part of it offers to highlight it.
 *
 * Selection is how highlights actually get made — a form asking somebody to
 * paste the passage they just read is a form nobody fills in. The button
 * appears over the selection and goes away when it does.
 */
export function HighlightSelection({
  source,
  children,
  className,
}: {
  source: HighlightSource;
  children: ReactNode;
  className?: string;
}) {
  const { user } = useCurrentUser();
  const containerRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [composing, setComposing] = useState(false);

  const readSelection = useCallback(() => {
    const selection = window.getSelection();
    const container = containerRef.current;

    if (!selection || selection.isCollapsed || !container) {
      setPicked(null);
      return;
    }

    /**
     * Only selections inside this block. Without the check, selecting text in
     * a sidebar or a comment offers to highlight it as though it were part of
     * the article — attributing somebody else's words to the author.
     */
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setPicked(null);
      return;
    }

    const text = normaliseSelection(selection.toString());
    if (text.length < 2) {
      setPicked(null);
      return;
    }

    const rect = range.getBoundingClientRect();

    /**
     * The paragraph the selection sits in, so a highlight of half a sentence
     * carries enough around it to make sense. Skipped when the selection is
     * the whole block already — repeating it as context is noise.
     */
    const block =
      range.commonAncestorContainer.parentElement?.closest(
        'p, li, blockquote, h1, h2, h3'
      );

    const context =
      block && normaliseSelection(block.textContent ?? '') !== text
        ? trimContext(block.textContent ?? '')
        : undefined;

    setPicked({
      text,
      context,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    document.addEventListener('selectionchange', readSelection);
    return () => document.removeEventListener('selectionchange', readSelection);
  }, [user, readSelection]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {children}

      {picked && !composing && user && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full pb-2"
          style={{ left: picked.x, top: picked.y }}
        >
          <div className="flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-lg">
            <HighlightAction
              source={source}
              picked={picked}
              onDone={() => setPicked(null)}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => setComposing(true)}
            >
              <MessageSquareQuote className="h-3.5 w-3.5" />
              Quote
            </Button>
          </div>
        </div>
      )}

      {picked && (
        <QuoteHighlightDialog
          open={composing}
          onOpenChange={setComposing}
          source={source}
          picked={picked}
          onDone={() => {
            setComposing(false);
            setPicked(null);
          }}
        />
      )}
    </div>
  );
}

function HighlightAction({
  source,
  picked,
  onDone,
}: {
  source: HighlightSource;
  picked: Picked;
  onDone: () => void;
}) {
  const { mutateAsync: highlight, isPending } = useCreateHighlight();

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-8 gap-1.5 px-2 text-xs"
      disabled={isPending}
      onClick={async () => {
        await highlight({
          content: picked.text,
          context: picked.context,
          sourceEventId: source.eventId,
          sourceAddress: source.address,
          sourceUrl: source.url,
          attribution: source.authorPubkey
            ? [{ pubkey: source.authorPubkey, role: 'author' }]
            : [],
        }).catch(() => undefined);

        window.getSelection()?.removeAllRanges();
        onDone();
      }}
    >
      <Highlighter className="h-3.5 w-3.5" />
      {isPending ? 'Saving…' : 'Highlight'}
    </Button>
  );
}

/**
 * A quote highlight: the passage plus a remark, in one event.
 *
 * One event rather than a highlight and a kind 1, which is what the `comment`
 * tag exists to prevent — two notes in a row saying the same thing is what
 * this looks like in a microblogging client otherwise.
 */
function QuoteHighlightDialog({
  open,
  onOpenChange,
  source,
  picked,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: HighlightSource;
  picked: Picked;
  onDone: () => void;
}) {
  const [comment, setComment] = useState('');
  const { mutateAsync: highlight, isPending } = useCreateHighlight();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quote this highlight</DialogTitle>
        </DialogHeader>

        <blockquote className="rounded-lg border bg-muted/30 p-3 text-sm italic">
          “{picked.text}”
        </blockquote>

        <Textarea
          value={comment}
          onChange={(changed) => setComment(changed.target.value)}
          placeholder="What do you want to say about it?"
          rows={3}
          autoFocus
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={isPending || !comment.trim()}
            onClick={async () => {
              await highlight({
                content: picked.text,
                context: picked.context,
                comment,
                sourceEventId: source.eventId,
                sourceAddress: source.address,
                sourceUrl: source.url,
                attribution: source.authorPubkey
                  ? [{ pubkey: source.authorPubkey, role: 'author' }]
                  : [],
              }).catch(() => undefined);

              setComment('');
              window.getSelection()?.removeAllRanges();
              onDone();
            }}
          >
            {isPending ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
