import { useEffect, useRef, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { usePostReply } from '@/hooks/usePostReply';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface ThreadComposerProps {
  /** The note this reply answers. */
  parent: NostrEvent;
  /** Name shown in the placeholder, so it is clear who is being answered. */
  replyingToName?: string;
  autoFocus?: boolean;
  onDone?: () => void;
  onCancel?: () => void;
  className?: string;
}

/**
 * A reply box that sits directly under the note it answers.
 *
 * Inline rather than in a dialog: at depth, a modal loses the thing being
 * replied to, and the reader has to remember it. Keeping the box in place
 * keeps the parent on screen while the reply is written.
 */
export function ThreadComposer({
  parent,
  replyingToName,
  autoFocus,
  onDone,
  onCancel,
  className,
}: ThreadComposerProps) {
  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey || '');
  const { mutateAsync: postReply, isPending } = usePostReply();
  const { toast } = useToast();

  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  if (!user) return null;

  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(user.pubkey);

  const submit = async () => {
    const trimmed = content.trim();
    if (!trimmed || isPending) return;

    try {
      await postReply({ parent, content: trimmed });
      setContent('');
      onDone?.();
    } catch (error) {
      toast({
        title: 'Reply failed',
        description: (error as Error)?.message || 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <form
      className={cn('flex items-start gap-3', className)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-[10px]">
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-2">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
            // Escape backs out of a reply box opened deep in a thread
            if (event.key === 'Escape' && onCancel) {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder={
            replyingToName ? `Reply to ${replyingToName}…` : 'Write a reply…'
          }
          aria-label={
            replyingToName ? `Reply to ${replyingToName}` : 'Write a reply'
          }
          className="min-h-[68px] resize-none bg-background text-sm"
        />

        <div className="flex items-center justify-end gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {content.length}
          </span>
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={isPending || !content.trim()}>
            {isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Reply
          </Button>
        </div>
      </div>
    </form>
  );
}
