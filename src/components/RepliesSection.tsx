import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { ArrowDown } from 'lucide-react';
import { useThread } from '@/hooks/useThread';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEvent } from '@/hooks/useEvent';
import { Skeleton } from '@/components/ui/skeleton';
import { ThreadComposer } from '@/components/thread/ThreadComposer';
import { ThreadReply } from '@/components/thread/ThreadReply';
import { countDescendants } from '@/lib/thread';
import { cn } from '@/lib/utils';

interface RepliesSectionProps {
  eventId: string;
  className?: string;
}

/** Replies shown inline in the feed before the rest move to the thread page. */
const FEED_PREVIEW = 5;

/**
 * A note's replies, expanded in place in the feed.
 *
 * Shares its rows with the thread page, so a conversation looks the same
 * wherever it is read. Only the first few are kept here — the feed is for
 * scanning, and a long thread belongs on its own page.
 */
export function RepliesSection({ eventId, className }: RepliesSectionProps) {
  const { tree, total, isLoading } = useThread(eventId, eventId);
  const { user } = useCurrentUser();
  const { data: rootEvent } = useEvent(eventId);

  const shown = tree.slice(0, FEED_PREVIEW);
  // The preview carries whole subtrees, so what's left out is everything the
  // conversation holds minus everything those subtrees contain
  const shownCount = shown.reduce(
    (count, node) => count + 1 + countDescendants(node),
    0
  );
  const hidden = Math.max(0, total - shownCount);

  return (
    <div className={cn('space-y-3', className)}>
      {user && rootEvent && (
        <ThreadComposer parent={rootEvent} className="rounded-lg bg-muted/40 p-3" />
      )}

      {isLoading ? (
        <RepliesSkeleton />
      ) : tree.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No replies yet.
        </p>
      ) : (
        <>
          <ul>
            {shown.map((node) => (
              <ThreadReply key={node.event.id} node={node} depth={0} />
            ))}
          </ul>

          {hidden > 0 && (
            <Link
              to={`/${nip19.noteEncode(eventId)}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <ArrowDown className="h-3 w-3" />
              Read the full thread · {hidden} more{' '}
              {hidden === 1 ? 'reply' : 'replies'}
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function RepliesSkeleton() {
  return (
    <div className="space-y-4 py-2" aria-label="Loading replies">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
