import { useParams, Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { ArrowLeft, Users, Radio } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useLiveEvent } from '@/hooks/useLiveEvent';
import { useSeo } from '@/hooks/useSeo';
import { genUserName } from '@/lib/genUserName';
import {
  effectiveStatus,
  hostOf,
  isWatchable,
  type LiveEvent,
} from '@/lib/nip53';
import { relativeTime } from '@/lib/time';
import { LiveChat } from '@/components/live';
import { LinkedZapGoal } from '@/components/ZapGoalCard';
import { ZapButton } from '@/components/ZapButton';

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
        <StreamNotFound message="That link does not point at a live stream." />
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
        <StreamNotFound message="Could not find that stream. It may have ended or the relay may not have it." />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/live">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All streams
          </Link>
        </Button>

        <StreamHeader live={live} />

        {/*
          NIP-75: a stream raising funds carries a `goal` tag naming the goal
          event. Rendered between the header and the chat, which is where
          Zap.stream puts it — the thing being funded next to the thing
          asking for funds.
        */}
        <LinkedZapGoal event={live.event} />

        <LiveChat live={live} />
      </div>
    </Layout>
  );
}

function StreamNotFound({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/live">
          <ArrowLeft className="mr-2 h-4 w-4" />
          All streams
        </Link>
      </Button>
      <Card className="border-dashed">
        <CardContent className="px-8 py-12 text-center">
          <p className="text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function StreamHeader({ live }: { live: LiveEvent }) {
  const status = effectiveStatus(live);
  const watchable = isWatchable(live);
  const host = hostOf(live);

  return (
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
              <h1 className="text-xl font-bold leading-tight">{live.title}</h1>
              {status === 'live' && (
                <Badge className="shrink-0 gap-1.5 border-transparent bg-destructive text-destructive-foreground">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                  LIVE
                </Badge>
              )}
              {status === 'ended' && <Badge variant="secondary">Ended</Badge>}
            </div>

            {live.summary && (
              <p className="text-sm text-muted-foreground">{live.summary}</p>
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

          {/*
            Zapping the stream event itself. When the stream carries a `goal`
            tag, useZaps reads it and routes the receipt to the goal's relays
            with the goal id in the `e` tag — so a zap here funds the goal.
          */}
          <ZapButton target={live.event} showCount={false} className="shrink-0" />
        </div>
      </CardContent>
    </Card>
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
