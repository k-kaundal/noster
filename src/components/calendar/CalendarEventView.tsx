import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import {
  CalendarDays,
  Clock,
  ExternalLink,
  Globe,
  Hash,
  MapPin,
  Users,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { MaybeWarned } from '@/components/ContentWarning';
import { NoteContent } from '@/components/NoteContent';
import { CommentsSection } from '@/components/comments/CommentsSection';
import { RsvpControls } from '@/components/calendar/RsvpControls';
import { AddToCalendar } from '@/components/calendar/AddToCalendar';
import { useAuthor } from '@/hooks/useAuthor';
import { readContentWarning } from '@/lib/contentWarning';
import { genUserName } from '@/lib/genUserName';
import {
  foreignZone,
  formatWhen,
  hasPassed,
  isDateBased,
  timeInZone,
  type CalendarEvent,
  type Participant,
} from '@/lib/nip52';

/** A calendar event in full, with the RSVP controls. */
export function CalendarEventView({
  calendarEvent,
}: {
  calendarEvent: CalendarEvent;
}) {
  const { event } = calendarEvent;
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);

  const warning = readContentWarning(event);
  const past = hasPassed(calendarEvent);

  const address = `${event.kind}:${event.pubkey}:${calendarEvent.slug}`;
  const hostNpub = nip19.npubEncode(event.pubkey);

  /**
   * The host's own timezone, named only when it differs from the reader's.
   * A conference at 09:00 in Costa Rica is 16:00 in Berlin, and a reader who
   * sees only their own clock has no way to check they are looking at the
   * right event.
   */
  const hostZone = isDateBased(calendarEvent)
    ? null
    : (() => {
        const zone = foreignZone(calendarEvent);
        if (!zone) return null;

        const clock = timeInZone(calendarEvent.start, zone);
        return clock ? { zone, clock } : null;
      })();

  return (
    <div className="space-y-6">
      {calendarEvent.image && (
        <MaybeWarned event={event} warning={warning} opaque>
          <img
            src={calendarEvent.image}
            alt=""
            className="max-h-80 w-full rounded-xl object-cover"
            loading="lazy"
          />
        </MaybeWarned>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-title">{calendarEvent.title}</h1>
          {past && <Badge variant="secondary">Past event</Badge>}
        </div>

        {calendarEvent.summary && (
          <p className="text-muted-foreground">{calendarEvent.summary}</p>
        )}

        <Link
          to={`/${hostNpub}`}
          className="inline-flex items-center gap-2 text-sm hover:underline"
        >
          <Avatar className="h-6 w-6">
            <AvatarImage src={metadata?.picture} alt="" />
            <AvatarFallback className="text-[10px]">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-muted-foreground">Hosted by</span>
          <span className="font-medium">{displayName}</span>
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-3 py-4 text-sm">
          <div className="flex items-start gap-2.5">
            {isDateBased(calendarEvent) ? (
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div>
              <p>{formatWhen(calendarEvent)}</p>

              {isDateBased(calendarEvent) && (
                <p className="text-xs text-muted-foreground">
                  All day — the same dates wherever you are.
                </p>
              )}

              {hostZone && (
                <p className="text-xs text-muted-foreground">
                  {hostZone.clock} in {hostZone.zone}
                </p>
              )}
            </div>
          </div>

          {calendarEvent.locations.map((location) => (
            <div key={location} className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              {/^https?:\/\//.test(location) ? (
                <a
                  href={location}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all hover:underline"
                >
                  {location}
                </a>
              ) : (
                <span>{location}</span>
              )}
            </div>
          ))}

          {calendarEvent.geohash && (
            <div className="flex items-start gap-2.5">
              <Globe className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-mono text-xs text-muted-foreground">
                {calendarEvent.geohash}
              </span>
            </div>
          )}

          {calendarEvent.references.map((reference) => (
            <div key={reference} className="flex items-start gap-2.5">
              <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <a
                href={reference}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all hover:underline"
              >
                {reference}
              </a>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 py-4">
          <RsvpControls calendarEvent={calendarEvent} address={address} />

          <div className="flex justify-end border-t pt-3">
            <AddToCalendar address={address} />
          </div>
        </CardContent>
      </Card>

      {calendarEvent.participants.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-muted-foreground" />
            Taking part
          </h2>
          <div className="space-y-1.5">
            {calendarEvent.participants.map((participant) => (
              <ParticipantRow
                key={participant.pubkey}
                participant={participant}
              />
            ))}
          </div>
        </div>
      )}

      {calendarEvent.content.trim() && (
        <>
          <Separator />
          <MaybeWarned event={event} warning={warning}>
            <div className="whitespace-pre-wrap break-words">
              <NoteContent event={event} className="text-sm" />
            </div>
          </MaybeWarned>
        </>
      )}

      {calendarEvent.hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {calendarEvent.hashtags.map((tag) => (
            <Link key={tag} to={`/calendar?t=${encodeURIComponent(tag)}`}>
              <Badge variant="secondary" className="gap-1">
                <Hash className="h-3 w-3" />
                {tag}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      <Separator />

      <CommentsSection
        root={event}
        title="Discussion"
        emptyStateMessage="No comments yet"
        emptyStateSubtitle="Ask the host a question about this event."
      />
    </div>
  );
}

function ParticipantRow({ participant }: { participant: Participant }) {
  const author = useAuthor(participant.pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(participant.pubkey);

  return (
    <Link
      to={`/${nip19.npubEncode(participant.pubkey)}`}
      className="flex items-center gap-2.5 rounded-lg p-1.5 text-sm transition-colors hover:bg-accent/60"
    >
      <Avatar className="h-7 w-7">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-[10px]">
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="truncate font-medium">{displayName}</span>
      {participant.role && (
        <Badge variant="outline" className="shrink-0 text-xs">
          {participant.role}
        </Badge>
      )}
    </Link>
  );
}
