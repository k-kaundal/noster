import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Send } from 'lucide-react';

interface QuickReplyProps {
  replyingTo: NostrEvent;
  onReplyPosted?: () => void;
  className?: string;
}

export function QuickReply({ replyingTo, onReplyPosted, className }: QuickReplyProps) {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { user } = useCurrentUser();
  const currentUserAuthor = useAuthor(user?.pubkey || '');
  const { mutateAsync: createEvent } = useNostrPublish();

  const currentUserMetadata = currentUserAuthor.data?.metadata;
  const currentUserDisplayName = currentUserMetadata?.display_name || currentUserMetadata?.name || genUserName(user?.pubkey || '');
  const currentUserProfileImage = currentUserMetadata?.picture;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast({
        title: "Not logged in",
        description: "Please log in to reply.",
        variant: "destructive",
      });
      return;
    }

    if (!content.trim()) {
      toast({
        title: "Empty reply",
        description: "Please add some content.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Create reply tags according to NIP-10
      const replyTags = [
        ['e', replyingTo.id, '', replyingTo.pubkey], // Reply to this event
        ['p', replyingTo.pubkey], // Mention the author
      ];

      await createEvent({
        kind: 1,
        content: content.trim(),
        tags: replyTags,
      });

      toast({
        title: "Reply posted",
        description: "Your reply has been published successfully.",
      });

      // Invalidate replies query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['replies', replyingTo.id] });

      // Reset form
      setContent('');

      // Notify parent component
      onReplyPosted?.();
    } catch (error) {
      console.error('Reply creation error:', error);
      toast({
        title: "Failed to post reply",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className={className}>
      <form onSubmit={handleSubmit}>
        <div className="flex items-start gap-2.5">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={currentUserProfileImage} alt="" />
            <AvatarFallback className="text-[10px]">
              {currentUserDisplayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-2">
            <Textarea
              placeholder="Write a reply…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              aria-label="Write a reply"
              className="min-h-[72px] resize-none bg-background text-sm"
            />

            <div className="flex items-center justify-end gap-3">
              <span className="text-xs tabular-nums text-muted-foreground">
                {content.length}
              </span>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || !content.trim()}
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <Send className="mr-2 h-3 w-3" />
                )}
                Reply
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}