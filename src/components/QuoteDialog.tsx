import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { Loader2, Quote, Send } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { QuotedNote } from '@/components/QuotedNote';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { buildQuoteTags } from '@/lib/note';

interface QuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoting: NostrEvent;
}

/**
 * Composes a NIP-18 quote repost: a normal kind 1 note that references the
 * quoted event with a `q` tag, so it reads as its own post rather than a reply.
 */
export function QuoteDialog({ open, onOpenChange, quoting }: QuoteDialogProps) {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey || '');
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(user?.pubkey || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSubmitting(true);
    try {
      // The nostr: URI keeps the quote visible in clients that ignore `q`
      const nevent = nip19.neventEncode({
        id: quoting.id,
        author: quoting.pubkey,
      });
      const body = content.trim()
        ? `${content.trim()}\n\nnostr:${nevent}`
        : `nostr:${nevent}`;

      await createEvent({
        kind: 1,
        content: body,
        tags: buildQuoteTags(quoting),
      });

      toast({
        title: 'Quote published',
        description: 'Your quote is on its way to the relays.',
      });

      queryClient.invalidateQueries({ queryKey: ['feed'] });
      setContent('');
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Failed to publish quote',
        description: (error as Error)?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Quote className="h-4 w-4" />
            Quote this note
          </DialogTitle>
          <DialogDescription>
            Your comment posts as a new note with the original attached.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-start gap-3">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={metadata?.picture} alt="" />
              <AvatarFallback className="text-xs">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1 space-y-3">
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder="Add a comment…"
                className="min-h-[90px] resize-none"
                autoFocus
              />

              <QuotedNote eventId={quoting.id} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-brand-gradient"
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Post quote
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
