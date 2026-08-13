import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { CalendarDays, Clock, MapPin, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { MaybeWarned } from '@/components/ContentWarning';
import { useAuthor } from '@/hooks/useAuthor';
import { readContentWarning } from '@/lib/contentWarning';
import { genUserName } from '@/lib/genUserName';
import {
  formatInReaderZone,
  formatWhen,
  hasPassed,
  isDateBased,
  startSquare,
  type CalendarEvent,
} from '@/lib/nip52';
import { cn } from '@/lib/utils';

/**
 * A calendar event in a list.
 *
 * The date block on the left is the thing people scan, so it carries the
 * calendar-square shape even for a timed event — the difference between the
 * two kinds belongs in the detail line underneath, not in two different card
 * layouts a reader has to learn.
 */
export function CalendarEventCard({
  calendarEvent,
  className,
}: {
  calendarEvent: CalendarEvent;
  className?: string;
}) {
  const { event } = calendarEvent;
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);

  const naddr = nip19.naddrEncode({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: calendarEvent.slug,
  });

  const warning = readContentWarning(event);
  const past = hasPassed(calendarEvent);

  const square = startSquare(calendarEvent);

  /** The reader's own clock, when the event keeps a different one. */
  const yourTime = formatInReaderZone(calendarEvent);

  const [location] = calendarEvent.locations;

  return (
    <Card
      className={cn(
        'content-auto overflow-hidden hover-lift',
        past && 'opacity-70',
        className
      )}
    >
      <Link to={`/${naddr}`} className="flex gap-4 p-4">
        {/* The tear-off calendar square, which is what a reader's eye lands on */}
        <div
          className={cn(
            'flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border text-center',
            past ? 'bg-muted' : 'bg-primary/10 border-primary/30'
          )}
          aria-hidden="true"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {square.month}
          </span>
          <span className="text-2xl font-bold leading-none tabular-nums">
            {square.day}
          </span>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 font-semibold leading-snug">
              {calendarEvent.title}
            </h3>

            {past && (
              <Badge variant="secondary" className="shrink-0">
                Past
              </Badge>
            )}
          </div>

          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {isDateBased(calendarEvent) ? (
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Clock className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{formatWhen(calendarEvent)}</span>
          </p>

          {/*
            The event's clock is the headline above; this is the reader's.
            Shown only when they differ, and it is the line that answers "can
            I actually be there for that".
          */}
          {yourTime && (
            <p className="pl-5 text-xs text-muted-foreground">
              {yourTime} your time
            </p>
          )}

          {location && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{location}</span>
            </p>
          )}

          {calendarEvent.summary && (
            <MaybeWarned event={event} warning={warning}>
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {calendarEvent.summary}
              </p>
            </MaybeWarned>
          )}

          <div className="flex items-center gap-2 pt-0.5 text-xs text-muted-foreground">
            <Avatar className="h-5 w-5">
              <AvatarImage src={metadata?.picture} alt="" />
              <AvatarFallback className="text-[9px]">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{displayName}</span>

            {calendarEvent.participants.length > 0 && (
              <span className="flex shrink-0 items-center gap-1">
                <Users className="h-3 w-3" />
                {calendarEvent.participants.length}
              </span>
            )}
          </div>
        </div>
      </Link>
    </Card>
  );
}
