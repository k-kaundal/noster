import { Link } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { FileQuestion, FileText, Film, Clock, Ban } from 'lucide-react';
import { NoteContent } from '@/components/NoteContent';
import { StructuredPayload } from '@/components/notes/StructuredPayload';
import { PollContent } from '@/components/notes/PollContent';
import { parsePoll } from '@/lib/poll';
import { Badge } from '@/components/ui/badge';
import {
  getAltText,
  getNoteRenderKind,
  isRenderableEvent,
  kindLabel,
  parseJsonContent,
} from '@/lib/eventKinds';
import { getTagValue, readingTimeMinutes } from '@/lib/note';
import { formatDuration, parseVideoEvent } from '@/lib/video';
import { cn } from '@/lib/utils';

interface NoteBodyProps {
  event: NostrEvent;
  className?: string;
}

/**
 * Renders an event's body according to its kind, so the timeline stays
 * readable whatever a relay serves up. Falls back to NIP-31's `alt` text for
 * kinds this client doesn't render natively.
 */
export function NoteBody({ event, className }: NoteBodyProps) {
  const renderKind = getNoteRenderKind(event);

  // An empty body would otherwise render as a blank card with no explanation
  if (!isRenderableEvent(event)) {
    return <EmptyNote className={className} />;
  }

  switch (renderKind) {
    case 'text':
      return <NoteContent event={event} className={className} />;

    case 'structured':
      return (
        <StructuredPayload
          data={parseJsonContent(event.content)}
          label={kindLabel(event.kind)}
          className={className}
        />
      );

    case 'poll': {
      const poll = parsePoll(event);
      // A poll with fewer than two options falls back to the unknown card
      return poll ? (
        <PollContent event={event} poll={poll} className={className} />
      ) : (
        <UnknownKind event={event} className={className} />
      );
    }

    case 'article':
      return <ArticlePreview event={event} className={className} />;

    case 'video':
      return <VideoPreview event={event} className={className} />;

    case 'picture':
      // Kind 20 carries its images in imeta tags, which NoteContent embeds
      return <NoteContent event={event} className={className} />;

    default: {
      // For unknown kinds, check if content is JSON and display it nicely
      const jsonContent = parseJsonContent(event.content);
      if (jsonContent) {
        return (
          <StructuredPayload
            data={jsonContent}
            label={kindLabel(event.kind)}
            className={className}
          />
        );
      }
      return <UnknownKind event={event} className={className} />;
    }
  }
}

function ArticlePreview({
  event,
  className,
}: {
  event: NostrEvent;
  className?: string;
}) {
  const title = getTagValue(event, 'title');
  const summary = getTagValue(event, 'summary');
  const image = getTagValue(event, 'image');
  const identifier = getTagValue(event, 'd');

  const naddr = identifier
    ? nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier,
      })
    : null;

  const body = (
    <div className="overflow-hidden rounded-lg border transition-colors hover:bg-accent/40">
      {image && (
        <img
          src={image}
          alt=""
          loading="lazy"
          className="h-40 w-full object-cover"
        />
      )}
      <div className="space-y-1.5 p-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
            <FileText className="h-3 w-3" />
            Article
          </Badge>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {readingTimeMinutes(event.content)} min read
          </span>
        </div>

        <p className="font-semibold leading-snug">
          {title ?? 'Untitled article'}
        </p>
        {summary && (
          <p className="line-clamp-3 text-sm text-muted-foreground">{summary}</p>
        )}
      </div>
    </div>
  );

  return (
    <div className={className}>
      {naddr ? <Link to={`/${naddr}`}>{body}</Link> : body}
    </div>
  );
}

function VideoPreview({
  event,
  className,
}: {
  event: NostrEvent;
  className?: string;
}) {
  const video = parseVideoEvent(event);
  const source = video.variants[0];
  const duration = formatDuration(video.durationSeconds);
  const isShort = event.kind === 22 || event.kind === 34236;

  if (!source) {
    return <UnknownKind event={event} className={className} />;
  }

  return (
    <div className={cn('space-y-2', className)}>
      {video.title && <p className="font-medium leading-snug">{video.title}</p>}

      <div className="relative overflow-hidden rounded-lg border bg-black">
        <video
          src={source.url}
          poster={source.image}
          controls
          preload="metadata"
          playsInline
          aria-label={video.alt ?? video.title ?? 'Video'}
          className={cn(
            'w-full bg-black',
            isShort ? 'max-h-[70vh] object-contain' : 'aspect-video object-contain'
          )}
        />

        {duration && (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {duration}
          </span>
        )}
      </div>

      {isShort && (
        <Link
          to="/reels"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Film className="h-3 w-3" />
          Watch in Reels
        </Link>
      )}
    </div>
  );
}

function UnknownKind({
  event,
  className,
}: {
  event: NostrEvent;
  className?: string;
}) {
  const alt = getAltText(event);
  const label = kindLabel(event.kind);

  return (
    <div className={cn('rounded-lg border border-dashed p-3', className)}>
      <div className="flex items-center gap-2">
        <FileQuestion className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">{label}</span>
        <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
          kind {event.kind}
        </Badge>
      </div>

      {/* NIP-31: the author's own summary for clients that can't render this */}
      {alt ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{alt}</p>
      ) : event.content.trim() ? (
        <p className="mt-2 line-clamp-6 whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {event.content}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          This event has no content this client can display.
        </p>
      )}
    </div>
  );
}

function EmptyNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground',
        className
      )}
    >
      <Ban className="h-3.5 w-3.5 shrink-0" />
      This note has no content.
    </p>
  );
}
