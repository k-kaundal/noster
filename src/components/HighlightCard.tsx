import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { ExternalLink, Highlighter } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { parseHighlight, type Highlight } from '@/lib/nip84';
import { cn } from '@/lib/utils';

/**
 * A highlight, rendered.
 *
 * With a `comment` this MUST look like a quote repost — the remark on top, the
 * highlighted passage as the quoted thing beneath. That is the entire point of
 * folding the two into one event: a client that rendered them as one flat note
 * would put the comment and the quote at the same level and lose which is
 * which, which is what the pairing was meant to avoid.
 */
export function HighlightCard({
  event,
  className,
}: {
  event: NostrEvent;
  className?: string;
}) {
  const highlight = parseHighlight(event);
  if (!highlight) return null;

  if (highlight.comment) {
    return (
      <div className={cn('space-y-2', className)}>
        <p className="whitespace-pre-wrap break-words text-[15px]">
          {highlight.comment}
        </p>
        <QuotedPassage highlight={highlight} />
      </div>
    );
  }

  return <QuotedPassage highlight={highlight} className={className} />;
}

function QuotedPassage({
  highlight,
  className,
}: {
  highlight: Highlight;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        'space-y-2 rounded-lg border bg-muted/30 p-3',
        className
      )}
    >
      <div className="flex items-start gap-2">
        <Highlighter className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />

        <blockquote className="min-w-0 flex-1 space-y-1">
          {highlight.content ? (
            <p className="whitespace-pre-wrap break-words text-sm italic">
              “{highlight.content}”
            </p>
          ) : (
            /* NIP-84 allows empty content for audio and video highlights */
            <p className="text-sm text-muted-foreground">
              Highlighted a moment in this media.
            </p>
          )}

          {/*
            Context is the paragraph around the passage, so it is shown quieter
            and below — it is what makes the quote make sense, not the quote.
          */}
          {highlight.context &&
            highlight.context !== highlight.content && (
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {highlight.context}
              </p>
            )}
        </blockquote>
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Attribution highlight={highlight} />
        <SourceLink highlight={highlight} />
      </figcaption>
    </figure>
  );
}

/**
 * Who wrote the material, from the `p` tags that are not mentions.
 *
 * The distinction matters on screen and not only in the tags: crediting
 * somebody the commenter merely name-dropped as the author of the passage is
 * an attribution error this client would be making on their behalf.
 */
function Attribution({ highlight }: { highlight: Highlight }) {
  const [first] = highlight.attribution;
  const author = useAuthor(first?.pubkey);

  if (!first) return null;

  const metadata = author.data?.metadata;
  const name = metadata?.name || metadata?.display_name || genUserName(first.pubkey);
  const others = highlight.attribution.length - 1;

  return (
    <Link
      to={`/${nip19.npubEncode(first.pubkey)}`}
      className="flex items-center gap-1.5 hover:text-foreground"
    >
      <Avatar className="h-4 w-4">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-[8px]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">
        {name}
        {first.role === 'editor' && ' (editor)'}
        {others > 0 && ` +${others}`}
      </span>
    </Link>
  );
}

function SourceLink({ highlight }: { highlight: Highlight }) {
  if (highlight.sourceAddress) {
    const [kind, pubkey, identifier] = highlight.sourceAddress.split(':');

    try {
      const naddr = nip19.naddrEncode({
        kind: Number.parseInt(kind, 10),
        pubkey,
        identifier: identifier ?? '',
      });

      return (
        <Link to={`/${naddr}`} className="hover:text-foreground hover:underline">
          Read the original
        </Link>
      );
    } catch {
      // A malformed coordinate is not worth a broken link
      return null;
    }
  }

  if (highlight.sourceEventId) {
    return (
      <Link
        to={`/${nip19.noteEncode(highlight.sourceEventId)}`}
        className="hover:text-foreground hover:underline"
      >
        Read the original
      </Link>
    );
  }

  if (highlight.sourceUrl) {
    let host = highlight.sourceUrl;
    try {
      host = new URL(highlight.sourceUrl).host;
    } catch {
      // Shown as-is when it will not parse
    }

    return (
      <a
        href={highlight.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 hover:text-foreground hover:underline"
      >
        {host}
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  return null;
}
