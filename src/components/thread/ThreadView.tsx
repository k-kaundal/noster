import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowUp, BadgeCheck } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useThread } from '@/hooks/useThread';
import { useThreadAncestors } from '@/hooks/useThreadAncestors';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { UserHoverCard } from '@/components/UserHoverCard';
import { NoteBody } from '@/components/notes/NoteBody';
import { Post } from '@/components/Post';
import { ThreadComposer } from '@/components/thread/ThreadComposer';
import { ThreadReply } from '@/components/thread/ThreadReply';
import { getThreadPosition } from '@/lib/thread';

/**
 * A conversation, read top to bottom.
 *
 * The notes above the focused one come first so the reply has something to be
 * a reply to, then the note itself, then everything below it. Any reply can be
 * opened as its own page, which is what lets the thread go arbitrarily deep
 * without the indentation ever running out of room.
 */
export function ThreadView({ event }: { event: NostrEvent }) {
  const { user } = useCurrentUser();
  const { ancestors, truncated, isLoading: loadingAncestors } =
    useThreadAncestors(event);

  const { rootId } = getThreadPosition(event);
  const {
    tree,
    total,
    isLoading: loadingReplies,
  } = useThread(rootId ?? event.id, event.id);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        {(loadingAncestors || ancestors.length > 0) && (
          <div className="px-5 pt-5">
            {truncated && rootId && (
              <Link
                to={`/${nip19.noteEncode(rootId)}`}
                className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <ArrowUp className="h-3 w-3" />
                Jump to the start of this thread
              </Link>
            )}

            {loadingAncestors ? (
              <AncestorSkeleton />
            ) : (
              <ul>
                {ancestors.map((ancestor) => (
                  <AncestorRow key={ancestor.id} event={ancestor} />
                ))}
              </ul>
            )}
          </div>
        )}

        <Post
          event={event}
          showReplies={false}
          className="rounded-none border-0 shadow-none"
        />
      </Card>

      {user && (
        <Card className="p-4">
          <ThreadComposer parent={event} />
        </Card>
      )}

      <Card className="p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold">
          {total > 0
            ? `${total} ${total === 1 ? 'reply' : 'replies'}`
            : 'Replies'}
        </h2>

        {loadingReplies ? (
          <RepliesSkeleton />
        ) : tree.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No replies yet. {user ? 'Start the thread.' : 'Log in to reply.'}
          </p>
        ) : (
          <ul className="mt-3">
            {tree.map((node) => (
              <ThreadReply key={node.event.id} node={node} depth={0} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * One note above the focused reply, drawn compactly.
 *
 * The connector always continues downward, because there is always something
 * below an ancestor — the next ancestor, or the note being read.
 */
function AncestorRow({ event }: { event: NostrEvent }) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const username = metadata?.name || genUserName(event.pubkey);
  const npub = nip19.npubEncode(event.pubkey);
  const noteId = nip19.noteEncode(event.id);

  const timestamp = event.created_at * 1000;
  const when =
    timestamp > 0 && timestamp < Date.now() + 86_400_000
      ? formatDistanceToNowStrict(new Date(timestamp))
      : 'unknown';

  return (
    <li className="flex gap-3">
      <div className="flex w-9 shrink-0 flex-col items-center">
        <UserHoverCard pubkey={event.pubkey}>
          <Link to={`/${npub}`} tabIndex={-1} aria-hidden="true">
            <Avatar className="h-8 w-8">
              <AvatarImage src={metadata?.picture} alt="" />
              <AvatarFallback className="text-[10px]">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Link>
        </UserHoverCard>
        <span className="mt-1 w-px flex-1 rounded-full bg-border" />
      </div>

      <div className="min-w-0 flex-1 pb-4">
        <div className="flex flex-wrap items-center gap-x-1.5 text-sm">
          <UserHoverCard pubkey={event.pubkey}>
            <Link to={`/${npub}`} className="truncate font-semibold hover:underline">
              {displayName}
            </Link>
          </UserHoverCard>
          {metadata?.nip05 && (
            <BadgeCheck
              className="h-3.5 w-3.5 shrink-0 text-primary"
              aria-label="Verified NIP-05 address"
            />
          )}
          <span className="truncate text-xs text-muted-foreground">
            @{username}
          </span>
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <Link
            to={`/${noteId}`}
            className="shrink-0 text-xs text-muted-foreground hover:underline"
          >
            {when}
          </Link>
        </div>

        <div className="mt-1 text-[15px]">
          <NoteBody event={event} />
        </div>
      </div>
    </li>
  );
}

function AncestorSkeleton() {
  return (
    <div className="flex gap-3 pb-4">
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  );
}

function RepliesSkeleton() {
  return (
    <div className="space-y-4 py-3" aria-label="Loading replies">
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
