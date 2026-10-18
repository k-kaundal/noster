import { Music, ExternalLink } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { UserStatus } from '@/lib/nip38';

/**
 * The little "what are you up to" line under a name.
 *
 * Rendered inline next to a username or in a profile header, it shows one
 * status with its type-appropriate treatment. Music gets a note icon; general
 * gets nothing. An emoji-only status renders the emoji alone. A status with
 * a link gets a small "open" affordance.
 */
export function StatusBadge({
  status,
  className,
}: {
  status: UserStatus;
  className?: string;
}) {
  const isMusic = status.type === 'music';

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground',
        className
      )}
    >
      {isMusic && <Music className="h-3 w-3 shrink-0" />}
      {status.statusEmoji && (
        <span className="shrink-0">{status.statusEmoji}</span>
      )}
      {status.content && (
        <span className="truncate italic">{status.content}</span>
      )}
      {status.reference && (
        <a
          href={status.reference}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-primary hover:opacity-80"
          onClick={(event) => event.stopPropagation()}
          aria-label="Open link"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}
