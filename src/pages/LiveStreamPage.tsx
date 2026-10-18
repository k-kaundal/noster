import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { ArrowLeft, Users, Radio, MessageSquare, Send } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useSeo } from '@/hooks/useSeo';
import { useToast } from '@/hooks/useToast';
import { useLiveEvent } from '@/hooks/useLiveEvent';
import { useLiveChat } from '@/hooks/useLiveChat';
import { genUserName } from '@/lib/genUserName';
import {
  effectiveStatus,
  hostOf,
  isWatchable,
  LIVE_CHAT_KIND,
  type LiveEvent,
} from '@/lib/nip53';
import { relativeTime } from '@/lib/time';
import { NoteContent } from '@/components/NoteContent';
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * One live stream, with its chat.
 *
 * The listing page at `/live` shows every stream on the relay; this page is
 * for watching one. The video itself is not embedded — it comes from whatever
 * URL the host put in the event, and opening it here would mean claiming
 * responsibility for whatever that server serves. What this page does provide
 * is the chat (kind 1311), which is the part of a stream that is actually on
 * Nostr.
 */
export function LiveStreamPage() {
  const { naddr } = useParams<{ naddr: string }>();
  const { user } = useCurrentUser();

  const decoded = naddr ? decodeNaddr(naddr) : null;
  const { live, isLoading, error } = useLiveEvent(
    decoded?.pubkey,
    decoded?.identifier
  );

  useSeo({
    title: live ? `${live.title} — Live` : 'Live stream',
    description: live?.summary ?? 'A live stream announced on Nostr.',
    path: naddr ? `/live/${naddr}` : '/live',
    noindex: !live,
  });

  if (!decoded) {
    return (
      <Layout>
        <div className="space-y-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/live">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All streams
            </Link>
          </Button>
          <Card className="border-dashed">
            <CardContent className="px-8 py-12 text-center">
              <p className="text-muted-foreground">
                That link does not point at a live stream.
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </Layout>
    );
  }

  if (error || !live) {
    return (
      <Layout>
        <div className="space-y-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/live">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All streams
            </Link>
          </Button>
          <Card className="border-dashed">
            <CardContent className="px-8 py-12 text-center">
              <p className="text-muted-foreground">
                Could not find that stream. It may have ended or the relay may
                not have it.
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const status = effectiveStatus(live);
  const watchable = isWatchable(live);
  const host = hostOf(live);

  return (
    <Layout>
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/live">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All streams
          </Link>
        </Button>

        {/* The stream itself */}
        <Card className="overflow-hidden">
          {live.image && (
            <div className="aspect-video w-full overflow-hidden bg-muted">
              <img
                src={live.image}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          )}

          <CardContent className="space-y-4 p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold leading-tight">
                    {live.title}
                  </h1>
                  {status === 'live' && (
                    <Badge className="shrink-0 gap-1.5 border-transparent bg-destructive text-destructive-foreground">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                      LIVE
                    </Badge>
                  )}
                  {status === 'ended' && (
                    <Badge variant="secondary">Ended</Badge>
                  )}
                </div>

                {live.summary && (
                  <p className="text-sm text-muted-foreground">
                    {live.summary}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <HostLink pubkey={host} />
              {live.currentParticipants !== undefined && (
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {live.currentParticipants.toLocaleString()} watching
                </span>
              )}
              {live.starts && status === 'planned' && (
                <span>Starts {relativeTime(live.starts * 1000)}</span>
              )}
            </div>

            <div className="flex gap-2">
              {watchable ? (
                <Button asChild className="flex-1">
                  <a
                    href={live.streaming}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Radio className="mr-2 h-4 w-4" />
                    Watch stream
                  </a>
                </Button>
              ) : live.recording ? (
                <Button asChild variant="outline" className="flex-1">
                  <a
                    href={live.recording}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Watch the recording
                  </a>
                </Button>
              ) : status === 'planned' ? (
                <Button disabled className="flex-1">
                  Not started yet
                </Button>
              ) : (
                <Button disabled className="flex-1">
                  Stream offline
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Chat */}
        <ChatSection live={live} user={user} />
      </div>
    </Layout>
  );
}

function HostLink({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.display_name || metadata?.name || genUserName(pubkey);
  const npub = nip19.npubEncode(pubkey);

  return (
    <Link
      to={`/${npub}`}
      className="flex items-center gap-2 hover:text-foreground"
    >
      <Avatar className="h-6 w-6">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-[10px]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="font-medium">{name}</span>
    </Link>
  );
}

function ChatSection({
  live,
  user,
}: {
  live: LiveEvent;
  user: ReturnType<typeof useCurrentUser>['user'];
}) {
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
        tags: [['a', live.address]],
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

function decodeNaddr(naddr: string) {
  try {
    const decoded = nip19.decode(naddr);
    if (decoded.type !== 'naddr') return null;

    const data = decoded.data;
    if (data.kind !== 30311) return null;

    return {
      pubkey: data.pubkey,
      identifier: data.identifier,
    };
  } catch {
    return null;
  }
}

export default LiveStreamPage;
