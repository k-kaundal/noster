import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Radio, Users } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { RelaySelector } from '@/components/RelaySelector';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { useRouteSeo } from '@/hooks/useSeo';
import { genUserName } from '@/lib/genUserName';
import { hostOf, isWatchable, type LiveEvent } from '@/lib/nip53';
import { relativeTime } from '@/lib/time';

/**
 * Live activities, from NIP-53.
 *
 * This page used to render a hardcoded list of streams that did not exist,
 * with invented viewer counts. It reads kind 30311 now: an activity is an
 * event a host publishes describing a stream, and the video comes from
 * whatever `streaming` URL they put in it.
 *
 * That is the reason a page like this can exist here at all — hosting video is
 * somebody else's problem, and announcing it is a Nostr event like any other.
 */
export function LiveStreamingPage() {
  useRouteSeo('/live');

  const { live, upcoming, past, isLoading } = useLiveEvents();

  const nothing = !isLoading && !live.length && !upcoming.length && !past.length;

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={Radio}
          title="Live"
          description="Streams announced on Nostr. Anyone can host one; the video comes from wherever the host put it."
        />

        {isLoading && (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-40 rounded-xl" />
            ))}
          </div>
        )}

        {nothing && (
          <Card className="border-dashed">
            <CardContent className="px-8 py-12 text-center">
              <div className="mx-auto max-w-sm space-y-6">
                <p className="text-muted-foreground">
                  Nobody is streaming on these relays. Try another?
                </p>
                <RelaySelector className="w-full" />
              </div>
            </CardContent>
          </Card>
        )}

        <Shelf title="Live now" items={live} />
        <Shelf title="Upcoming" items={upcoming} />
        <Shelf title="Finished" items={past} />
      </div>
    </Layout>
  );
}

function Shelf({ title, items }: { title: string; items: LiveEvent[] }) {
  if (!items.length) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
          {items.length}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <StreamCard key={item.address} live={item} />
        ))}
      </div>
    </section>
  );
}

function StreamCard({ live }: { live: LiveEvent }) {
  const host = hostOf(live);
  const author = useAuthor(host);
  const metadata = author.data?.metadata;

  const name = metadata?.display_name || metadata?.name || genUserName(host);
  const watchable = isWatchable(live);
  const npub = nip19.npubEncode(host);

  return (
    <Card className="overflow-hidden">
      {live.image && (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <img
            src={live.image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-base leading-snug">{live.title}</h3>

          {watchable && (
            <Badge className="shrink-0 gap-1.5 border-transparent bg-destructive text-destructive-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              LIVE
            </Badge>
          )}
        </div>

        {live.summary && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {live.summary}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Link to={`/${npub}`} className="flex min-w-0 items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={metadata?.picture} alt="" />
              <AvatarFallback className="text-[10px]">
                {name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm text-muted-foreground hover:text-foreground">
              {name}
            </span>
          </Link>

          {live.currentParticipants !== undefined && (
            <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
              <Users className="h-3 w-3" />
              {live.currentParticipants.toLocaleString()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/*
            A link out, not a player. The stream is on the host's own
            infrastructure and this app has never touched it — opening it in
            place would mean claiming responsibility for whatever it serves.
          */}
          {watchable ? (
            <Button asChild size="sm" className="flex-1">
              <a href={live.streaming} target="_blank" rel="noopener noreferrer">
                Watch
              </a>
            </Button>
          ) : live.recording ? (
            <Button asChild size="sm" variant="outline" className="flex-1">
              <a href={live.recording} target="_blank" rel="noopener noreferrer">
                Watch the recording
              </a>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {live.starts
                ? `Starts ${relativeTime(live.starts * 1000)}`
                : 'No time announced yet'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default LiveStreamingPage;
