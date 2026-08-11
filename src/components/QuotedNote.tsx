import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { timeAgo as formatAge } from '@/lib/time';
import { BadgeCheck, Quote } from 'lucide-react';
import { useEvent } from '@/hooks/useEvent';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { NoteBody } from '@/components/notes/NoteBody';
import { MaybeWarned } from '@/components/ContentWarning';
import { getContentWarning } from '@/lib/note';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface QuotedNoteProps {
  eventId: string;
  className?: string;
}

/**
 * The note referenced by a NIP-18 `q` tag, rendered as an embedded card.
 * Deliberately read-only: quoted notes get no action bar, so the actions on
 * screen always belong to the note the reader is actually looking at.
 */
export function QuotedNote({ eventId, className }: QuotedNoteProps) {
  const { data: event, isLoading } = useEvent(eventId);

  if (isLoading) {
    return (
      <div className={cn('rounded-lg border p-3', className)}>
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-1.5 h-3 w-2/3" />
      </div>
    );
  }

  if (!event) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground',
          className
        )}
      >
        <Quote className="h-3.5 w-3.5 shrink-0" />
        The quoted note isn't available on your relays.
      </div>
    );
  }

  return <QuotedNoteCard event={event} className={className} />;
}

function QuotedNoteCard({
  event,
  className,
}: {
  event: NonNullable<ReturnType<typeof useEvent>['data']>;
  className?: string;
}) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const noteId = nip19.noteEncode(event.id);

  const timeAgo = (() => {
    const timestamp = event.created_at * 1000;
    if (!timestamp || timestamp <= 0) return '';
    try {
      return formatAge(timestamp);
    } catch {
      return '';
    }
  })();

  return (
    <Link
      to={`/${noteId}`}
      className={cn(
        'block rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/50',
        className
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        <Avatar className="h-5 w-5">
          <AvatarImage src={metadata?.picture} alt="" />
          <AvatarFallback className="text-[9px]">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="truncate font-semibold">{displayName}</span>
        {metadata?.nip05 && (
          <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        )}
        {timeAgo && (
          <>
            <span className="text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <span className="shrink-0 text-muted-foreground">{timeAgo}</span>
          </>
        )}
      </div>

      {/* Clipped so a long quote can't dominate the note quoting it */}
      <div className="mt-1.5 max-h-40 overflow-hidden text-sm">
        <MaybeWarned event={event} warning={getContentWarning(event)}>
          <NoteBody event={event} />
        </MaybeWarned>
      </div>
    </Link>
  );
}
