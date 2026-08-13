import { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { formatDate, formatTime, isSameDay } from '@/lib/time';
import { ArrowDown, ArrowLeft, BadgeCheck, Check, ShieldCheck, Zap } from 'lucide-react';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useChatReadState,
  useChatThread,
  useDmRelays,
  useSendDirectMessage,
} from '@/hooks/useDirectMessages';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { genUserName } from '@/lib/genUserName';
import { NoteContent } from '@/components/NoteContent';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { ZapTrigger } from '@/components/ZapTrigger';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/lib/nip17';

interface ChatThreadProps {
  peerPubkey: string;
  /**
   * Whether this thread owns the whole screen, as it does on a phone.
   *
   * It decides who is responsible for the notch and the home indicator. In a
   * card the page around it already handles both; full-screen there is
   * nothing else to, and a composer flush with the bottom edge sits under an
   * iPhone's home bar.
   */
  immersive?: boolean;
}

export function ChatThread({ peerPubkey, immersive }: ChatThreadProps) {
  const { user } = useCurrentUser();
  const { messages, pendingIds, isLoading } = useChatThread(peerPubkey);
  const { mutateAsync: send, isPending } = useSendDirectMessage();
  const { data: peerDmRelays } = useDmRelays(peerPubkey);

  const author = useAuthor(peerPubkey);
  const metadata = author.data?.metadata;
  /** Nobody can be paid without an address to pay. */
  const canZap = !!(metadata?.lud16 || metadata?.lud06);

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(peerPubkey);
  const npub = nip19.npubEncode(peerPubkey);

  const newest = messages[messages.length - 1]?.createdAt;

  const { ref: listRef, atBottom, onScroll, scrollToBottom } =
    useStickToBottom<HTMLDivElement>(newest);

  /*
   * On iOS the keyboard covers the bottom of the viewport without changing
   * it, so the composer is lifted by hand. Android is handled by the viewport
   * meta and reports 0 here.
   */
  const keyboardInset = useKeyboardInset();

  // The thread jumps to the newest message when the keyboard opens over it,
  // which is where somebody about to type is looking
  useEffect(() => {
    if (keyboardInset > 0) scrollToBottom();
  }, [keyboardInset, scrollToBottom]);

  // Having the thread open is what "read" means
  const { markRead } = useChatReadState();

  useEffect(() => {
    if (newest) markRead(peerPubkey, newest);
  }, [peerPubkey, newest, markRead]);

  const handleSend = useCallback(
    async (content: string) => {
      try {
        await send({ recipients: [peerPubkey], content });
        scrollToBottom(true);
        return true;
      } catch {
        return false;
      }
    },
    [peerPubkey, scrollToBottom, send]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className={cn(
          'flex shrink-0 items-center gap-2 border-b px-2 py-2 sm:gap-3 sm:px-3',
          /*
           * `pt-[…]` rather than the `safe-top` utility: that one sets
           * padding-top and would race the `py-2` beside it, whereas Tailwind
           * always emits pt after py. `max` keeps the normal padding on a
           * phone with no notch, where the inset is 0.
           */
          immersive && 'bg-background pt-[max(0.5rem,env(safe-area-inset-top))]'
        )}
      >
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
          // 44px: the smallest target iOS calls reliable, and this one is at
          // the very edge of the screen where accuracy is worst
          className="h-11 w-11 shrink-0 lg:hidden"
        >
          <Link to="/chat" aria-label="Back to conversations">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>

        <Link to={`/${npub}`} className="shrink-0" aria-hidden="true" tabIndex={-1}>
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
            <ShieldCheck className="h-3 w-3 shrink-0" />
            <span className="truncate">End-to-end encrypted · NIP-17</span>
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
          <ZapTrigger target={author.data.event}>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 text-zap"
            >
              <Zap className="h-5 w-5" />
              <span className="sr-only">Zap {displayName}</span>
            </Button>
          </ZapTrigger>
        )}
      </header>

      {/* A recipient with no kind 10050 list may simply never receive this */}
      {peerDmRelays && peerDmRelays.length === 0 && (
        <p className="shrink-0 border-b bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
          {displayName} hasn't published a private-message relay list, so
          delivery isn't guaranteed.
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onScroll}
          /*
           * `overscroll-contain` stops a flick at the top of the thread from
           * scrolling the page behind it or triggering Android's pull to
           * refresh, which on a chat means losing your place mid-read.
           */
          className="h-full space-y-1 overflow-y-auto overscroll-contain p-3 scrollbar-thin"
        >
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
                isPending={pendingIds.has(message.id)}
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
        </div>

        {/*
          Shown only while scrolled away from the newest message. A thread
          that follows new messages while somebody is reading older ones is
          worse than one that doesn't, so it doesn't — and this is the way
          back rather than a long scroll.
        */}
        {!atBottom && messages.length > 0 && (
          <Button
            size="icon"
            variant="secondary"
            onClick={() => scrollToBottom(true)}
            aria-label="Jump to latest message"
            className="absolute bottom-3 right-3 h-11 w-11 rounded-full shadow-lg"
          >
            <ArrowDown className="h-5 w-5" />
          </Button>
        )}
      </div>

      <div
        className={cn(
          'shrink-0 border-t p-2 sm:p-3',
          // Clears the home indicator, but only while the keyboard is shut —
          // an open keyboard covers that strip and the gap becomes a hole
          immersive &&
            !keyboardInset &&
            'pb-[max(0.5rem,env(safe-area-inset-bottom))]'
        )}
        // iOS only: lifts the composer clear of a keyboard the viewport does
        // not know about
        style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
      >
        <ChatComposer
          placeholder={`Message ${displayName}…`}
          isSending={isPending}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isOwn,
  isPending,
  showDaySeparator,
}: {
  message: ChatMessage;
  isOwn: boolean;
  isPending: boolean;
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
            /*
             * Wider on a phone, where 80% of a narrow screen leaves a column
             * a few words across. `break-words` is not optional here: a
             * pasted npub or URL is one unbreakable word longer than the
             * screen, and without it the bubble runs off the side.
             */
            'max-w-[85%] break-words rounded-2xl px-3 py-2 text-[15px] sm:max-w-[80%] sm:text-sm',
            // Selectable, so a message can be quoted or an address copied
            'select-text',
            isOwn
              ? 'rounded-br-md bg-primary text-primary-foreground'
              : 'rounded-bl-md bg-muted',
            // Sending is shown by dimming rather than a spinner, so the text
            // stays readable and nothing moves when it lands
            isPending && 'opacity-70'
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
            className={cn(
              'text-[15px] sm:text-sm',
              isOwn && '[&_a]:text-primary-foreground'
            )}
          />

          <span
            className={cn(
              'mt-0.5 flex items-center gap-1 text-[10px]',
              isOwn ? 'justify-end text-primary-foreground/70' : 'text-muted-foreground'
            )}
          >
            <time dateTime={timestamp.toISOString()}>
              {formatTime(timestamp)}
            </time>
            {isOwn &&
              (isPending ? (
                <span className="text-[10px]">Sending…</span>
              ) : (
                <Check className="h-3 w-3" aria-label="Sent" />
              ))}
          </span>
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
