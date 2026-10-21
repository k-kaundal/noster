import { useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useLiveChat } from '@/hooks/useLiveChat';
import { genUserName } from '@/lib/genUserName';
import { LIVE_CHAT_KIND, type LiveEvent } from '@/lib/nip53';
import { relativeTime } from '@/lib/time';
import { NoteContent } from '@/components/NoteContent';

/**
 * The chat for one live stream.
 *
 * Kind 1311 messages addressed to the stream's `a` tag, oldest first so the
 * conversation reads top-to-bottom. A stream chat is small enough that a
 * relay can answer the whole thing in one filter, and the refetch interval
 * keeps it current without a subscription.
 */
export function LiveChat({ live }: { live: LiveEvent }) {
  const { user } = useCurrentUser();
  const { messages, isLoading } = useLiveChat(live.address);
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!draft.trim() || !user) return;

    setSending(true);
    try {
      await publishEvent({
        kind: LIVE_CHAT_KIND,
        content: draft.trim(),
        tags: [['a', live.address, '', 'root']],
      });
      setDraft('');
    } catch (error) {
      toast({
        title: 'Could not send',
        description:
          error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          <h2 className="font-semibold">Chat</h2>
          <span className="text-xs text-muted-foreground">
            {messages.length} {messages.length === 1 ? 'message' : 'messages'}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="max-h-96 space-y-3 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : !messages.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No messages yet. Say something.
            </p>
          ) : (
            messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))
          )}
        </div>

        {user ? (
          <div className="flex gap-2 border-t pt-4">
            <Input
              placeholder="Say something…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button
              onClick={handleSend}
              disabled={!draft.trim() || sending}
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <p className="border-t pt-4 text-center text-sm text-muted-foreground">
            Log in to join the chat
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ChatMessage({ message }: { message: NostrEvent }) {
  const author = useAuthor(message.pubkey);
  const metadata = author.data?.metadata;
  const name =
    metadata?.display_name || metadata?.name || genUserName(message.pubkey);

  return (
    <div className="flex gap-2">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-[10px]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">
            {relativeTime(message.created_at * 1000)}
          </span>
        </div>
        <div className="text-sm">
          <NoteContent event={message} />
        </div>
      </div>
    </div>
  );
}
