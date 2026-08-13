import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { formatDate, formatTime, isSameDay } from '@/lib/time';
import { ArrowLeft, BadgeCheck, Loader2, Send, ShieldCheck, Zap } from 'lucide-react';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useChatReadState,
  useChatThread,
  useDmRelays,
  useSendDirectMessage,
} from '@/hooks/useDirectMessages';
import { genUserName } from '@/lib/genUserName';
import { NoteContent } from '@/components/NoteContent';
import { ZapDialog } from '@/components/ZapDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/lib/nip17';

interface ChatThreadProps {
  peerPubkey: string;
}

export function ChatThread({ peerPubkey }: ChatThreadProps) {
  const { user } = useCurrentUser();
  const { messages, isLoading } = useChatThread(peerPubkey);
  const { mutateAsync: send, isPending } = useSendDirectMessage();
  const { data: peerDmRelays } = useDmRelays(peerPubkey);

  const author = useAuthor(peerPubkey);
  const metadata = author.data?.metadata;
  /** Nobody can be paid without an address to pay. */
  const canZap = !!(author.data?.metadata?.lud16 || author.data?.metadata?.lud06);

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(peerPubkey);
  const npub = nip19.npubEncode(peerPubkey);

  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows, the way a chat app should
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  // Having the thread open is what "read" means
  const { markRead } = useChatReadState();
  const newest = messages[messages.length - 1]?.createdAt;

  useEffect(() => {
    if (newest) markRead(peerPubkey, newest);
  }, [peerPubkey, newest, markRead]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || isPending) return;

    // Clear optimistically; the composer restores it if the send fails
    setDraft('');
    try {
      await send({ recipients: [peerPubkey], content });
    } catch {
      setDraft(content);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b p-3">
        {/*
          The only way back on a phone. Below `lg` the conversation list is
          hidden while a thread is open, so without this the browser's own
          back gesture was the sole exit — and in an installed app there
          isn't one.
        */}
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="-ml-1 h-8 w-8 shrink-0 lg:hidden"
        >
          <Link to="/chat" aria-label="Back to conversations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>

        <Link to={`/${npub}`} className="shrink-0">
          <Avatar className="h-9 w-9">
            <AvatarImage src={metadata?.picture} alt="" />
            <AvatarFallback className="text-xs">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>

        <div className="min-w-0 flex-1">
          <Link
            to={`/${npub}`}
            className="flex items-center gap-1.5 text-sm font-semibold hover:underline"
          >
            <span className="truncate">{displayName}</span>
            {metadata?.nip05 && (
              <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            )}
          </Link>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            End-to-end encrypted · NIP-17
          </p>
        </div>

        {/*
          Paying the person you are talking to.

          A profile zap rather than one attached to a message: the messages
          here are encrypted, so a receipt naming one would publish the fact
          that a particular sealed event exists between two people — which is
          the one thing this screen is built not to leak. Zapping the profile
          says only what a profile zap always says.
        */}
        {canZap && author.data?.event && (
          <ZapDialog target={author.data.event}>
            <Button variant="ghost" size="sm" className="shrink-0 text-zap">
              <Zap className="h-4 w-4" />
              <span className="sr-only">Zap {displayName}</span>
            </Button>
          </ZapDialog>
        )}
      </header>

      {/* A recipient with no kind 10050 list may simply never receive this */}
      {peerDmRelays && peerDmRelays.length === 0 && (
        <p className="border-b bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
          {displayName} hasn't published a private-message relay list, so
          delivery isn't guaranteed.
        </p>
      )}

      <div className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">
        {isLoading ? (
          <MessagesSkeleton />
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No messages yet. Say hello.
          </p>
        ) : (
          messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              isOwn={message.pubkey === user?.pubkey}
              showDaySeparator={
                index === 0 ||
                !isSameDay(
                  message.createdAt * 1000,
                  messages[index - 1].createdAt * 1000
                )
              }
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline, as chat apps behave
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`Message ${displayName}…`}
            aria-label="Message"
            className="max-h-32 min-h-[42px] flex-1 resize-none py-2.5"
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={!draft.trim() || isPending}
            size="icon"
            className="h-[42px] w-[42px] shrink-0"
            aria-label="Send message"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isOwn,
  showDaySeparator,
}: {
  message: ChatMessage;
  isOwn: boolean;
  showDaySeparator: boolean;
}) {
  const timestamp = new Date(message.createdAt * 1000);

  return (
    <>
      {showDaySeparator && (
        <div className="py-3 text-center">
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
            {formatDate(timestamp)}
          </span>
        </div>
      )}

      <div className={cn('flex', isOwn ? 'justify-end' : 'justify-start')}>
        <div
          className={cn(
            'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
            isOwn
              ? 'rounded-br-md bg-primary text-primary-foreground'
              : 'rounded-bl-md bg-muted'
          )}
        >
          {/* Links and mentions stay live inside a message */}
          <NoteContent
            event={{
              id: message.id,
              pubkey: message.pubkey,
              kind: 14,
              tags: [],
              content: message.content,
              created_at: message.createdAt,
              sig: '',
            }}
            className={cn('text-sm', isOwn && '[&_a]:text-primary-foreground')}
          />

          <time
            dateTime={timestamp.toISOString()}
            className={cn(
              'mt-0.5 block text-[10px]',
              isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground'
            )}
          >
            {formatTime(timestamp)}
          </time>
        </div>
      </div>
    </>
  );
}

function MessagesSkeleton() {
  return (
    <div className="space-y-3 py-2">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className={cn('flex', index % 2 ? 'justify-end' : 'justify-start')}
        >
          <Skeleton
            className={cn('h-10 rounded-2xl', index % 2 ? 'w-40' : 'w-52')}
          />
        </div>
      ))}
    </div>
  );
}
