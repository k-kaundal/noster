import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Users, Radio } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import {
  effectiveStatus,
  hostOf,
  isWatchable,
  type LiveEvent,
} from '@/lib/nip53';
import { relativeTime } from '@/lib/time';

/**
 * A card for one live stream in a listing.
 *
 * The whole card is a link to the stream's detail page, which is where the
 * chat lives. The card itself only answers "is this worth opening": live
 * badge, title, host, viewer count, and when it starts or started.
 */
export function StreamCard({ live }: { live: LiveEvent }) {
  const host = hostOf(live);
  const author = useAuthor(host);
  const metadata = author.data?.metadata;

  const name = metadata?.display_name || metadata?.name || genUserName(host);
  const watchable = isWatchable(live);
  const status = effectiveStatus(live);
  const naddr = nip19.naddrEncode({
    kind: 30311,
    pubkey: live.author,
    identifier: live.identifier,
  });

  return (
    <Card className="overflow-hidden transition-colors hover:bg-accent/50">
      <Link to={`/live/${naddr}`} className="block">
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
            <h3 className="min-w-0 flex-1 text-base font-medium leading-snug">
              {live.title}
            </h3>

            {status === 'live' && (
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
            <span className="flex min-w-0 items-center gap-2">
              <Avatar className="h-6 w-6">
                <AvatarImage src={metadata?.picture} alt="" />
                <AvatarFallback className="text-[10px]">
                  {name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-sm text-muted-foreground">
                {name}
              </span>
            </span>

            {live.currentParticipants !== undefined && (
              <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                <Users className="h-3 w-3" />
                {live.currentParticipants.toLocaleString()}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {watchable ? (
              <span className="flex items-center gap-1 text-destructive">
                <Radio className="h-3 w-3" />
                Watch + chat
              </span>
            ) : live.recording ? (
              <span>Recording available</span>
            ) : live.starts ? (
              <span>Starts {relativeTime(live.starts * 1000)}</span>
            ) : (
              <span>No time announced yet</span>
            )}
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}
