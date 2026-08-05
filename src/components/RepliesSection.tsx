import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';
import { formatDistanceToNow } from 'date-fns';
import { nip19 } from 'nostr-tools';
import { BadgeCheck, ChevronDown, ChevronUp, MessageCircle } from 'lucide-react';
import { useReplies } from '@/hooks/useReplies';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEvent } from '@/hooks/useEvent';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { NoteContent } from '@/components/NoteContent';
import { QuickReply } from '@/components/QuickReply';
import { cn } from '@/lib/utils';

interface RepliesSectionProps {
  eventId: string;
  className?: string;
}

/** How deep replies nest before pointing at the dedicated thread page. */
const MAX_DEPTH = 3;
const NESTED_PREVIEW = 5;

function ReplyItem({ reply, level = 0 }: { reply: NostrEvent; level?: number }) {
  const author = useAuthor(reply.pubkey);
  const metadata = author.data?.metadata;
  const [showNested, setShowNested] = useState(false);

  const { replies: nestedReplies, replyCount: nestedReplyCount } = useReplies(
    reply.id
  );

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(reply.pubkey);
  const npub = nip19.npubEncode(reply.pubkey);
  const noteId = nip19.noteEncode(reply.id);
  const isMaxDepth = level >= MAX_DEPTH;

  const timeAgo = (() => {
    const timestamp = reply.created_at * 1000;
    if (!timestamp || timestamp <= 0 || timestamp > Date.now() + 86_400_000) {
      return 'unknown time';
    }
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch {
      return 'unknown time';
    }
  })();

  return (
    <li className={cn(level > 0 && 'ml-4 border-l pl-4 sm:ml-6')}>
      <div className="flex gap-2.5 py-2">
        <Link to={`/${npub}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
          <Avatar className="h-7 w-7">
            <AvatarImage src={metadata?.picture} alt="" />
            <AvatarFallback className="text-[10px]">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs">
            <Link to={`/${npub}`} className="font-semibold hover:underline">
              {displayName}
            </Link>
            {metadata?.nip05 && (
              <BadgeCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            )}
            <span className="text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <Link
              to={`/${noteId}`}
              className="text-muted-foreground hover:underline"
            >
              {timeAgo}
            </Link>
          </div>

          <NoteContent event={reply} className="text-sm" />

          {nestedReplyCount > 0 &&
            (isMaxDepth ? (
              <Link
                to={`/${noteId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <MessageCircle className="h-3 w-3" />
                View {nestedReplyCount} more{' '}
                {nestedReplyCount === 1 ? 'reply' : 'replies'}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setShowNested((open) => !open)}
                aria-expanded={showNested}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {showNested ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {showNested ? 'Hide' : 'Show'} {nestedReplyCount}{' '}
                {nestedReplyCount === 1 ? 'reply' : 'replies'}
              </button>
            ))}
        </div>
      </div>

      {showNested && !isMaxDepth && nestedReplies.length > 0 && (
        <ul>
          {[...nestedReplies]
            .sort((a, b) => a.created_at - b.created_at)
            .slice(0, NESTED_PREVIEW)
            .map((nested) => (
              <ReplyItem key={nested.id} reply={nested} level={level + 1} />
            ))}
          {nestedReplies.length > NESTED_PREVIEW && (
            <li className="ml-4 border-l pl-4 sm:ml-6">
              <Link
                to={`/${noteId}`}
                className="block py-2 text-xs font-medium text-primary hover:underline"
              >
                View {nestedReplies.length - NESTED_PREVIEW} more replies
              </Link>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * Threaded replies to an event. The caller decides when this is visible, so
 * there is no collapse toggle at this level.
 */
export function RepliesSection({ eventId, className }: RepliesSectionProps) {
  const { replies, isLoading } = useReplies(eventId);
  const { user } = useCurrentUser();
  const { data: rootEvent } = useEvent(eventId);

  return (
    <div className={cn('space-y-3', className)}>
      {user && rootEvent && (
        <QuickReply replyingTo={rootEvent} className="rounded-lg bg-muted/40 p-3" />
      )}

      {isLoading ? (
        <RepliesSkeleton />
      ) : replies.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No replies yet.
        </p>
      ) : (
        <ul className="divide-y">
          {[...replies]
            .sort((a, b) => a.created_at - b.created_at)
            .map((reply) => (
              <ReplyItem key={reply.id} reply={reply} />
            ))}
        </ul>
      )}
    </div>
  );
}

function RepliesSkeleton() {
  return (
    <div className="space-y-4 py-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-2.5">
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
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
