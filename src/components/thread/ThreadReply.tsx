import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { timeAgo as formatAge } from '@/lib/time';
import { BadgeCheck, ChevronRight, Heart, MessageCircle } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useReactions } from '@/hooks/useReactions';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserHoverCard } from '@/components/UserHoverCard';
import { NoteBody } from '@/components/notes/NoteBody';
import { ContentWarning } from '@/components/ContentWarning';
import { ThreadComposer } from '@/components/thread/ThreadComposer';
import { getContentWarning } from '@/lib/note';
import {
  countDescendants,
  MAX_VISIBLE_DEPTH,
  REPLIES_BEFORE_COLLAPSE,
  type ThreadNode,
} from '@/lib/thread';
import { cn } from '@/lib/utils';

interface ThreadReplyProps {
  node: ThreadNode;
  /** Indentation level, which stops climbing at `MAX_VISIBLE_DEPTH`. */
  depth: number;
}

/**
 * One reply and everything beneath it.
 *
 * Depth in a Nostr thread is unbounded, but indentation cannot be — past a few
 * levels a reply has no room left to be read on a phone. So indentation stops
 * and the conversation continues on the reply's own page, where it becomes the
 * focused note. Nothing is hidden; it just moves rather than shrinking.
 */
export function ThreadReply({ node, depth }: ThreadReplyProps) {
  const { event, children } = node;

  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { isLiked, likeCount, like, isLiking } = useReactions(event.id);

  const [collapsed, setCollapsed] = useState(false);
  const [replying, setReplying] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const username = metadata?.name || genUserName(event.pubkey);
  const npub = nip19.npubEncode(event.pubkey);
  const noteId = nip19.noteEncode(event.id);

  const total = countDescendants(node);
  const atDepthLimit = depth >= MAX_VISIBLE_DEPTH;
  const contentWarning = getContentWarning(event);

  // Long sibling runs are trimmed below the first level, where the thread is
  // already narrow and a hundred replies would bury whatever follows
  const trimmed =
    depth > 0 && !showAll && children.length > REPLIES_BEFORE_COLLAPSE;
  const visible = trimmed ? children.slice(0, REPLIES_BEFORE_COLLAPSE) : children;

  const showsSubtree = !collapsed && !atDepthLimit && children.length > 0;
  const lineActive = showsSubtree || (!collapsed && replying);

  const handleLike = async () => {
    if (!user) {
      toast({
        title: 'Login required',
        description: 'You must be logged in to react.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await like({ targetEvent: event });
    } catch (error) {
      toast({
        title: 'Reaction failed',
        description: (error as Error)?.message || 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <li>
      <div className="flex gap-3">
        {/* Fixed-width rail so the connector lands under the avatar at every
            depth, even where the avatar itself is smaller */}
        <div className="flex w-9 shrink-0 flex-col items-center">
          <UserHoverCard pubkey={event.pubkey}>
            <Link to={`/${npub}`} tabIndex={-1} aria-hidden="true">
              <Avatar className="h-8 w-8 transition-opacity hover:opacity-90">
                <AvatarImage src={metadata?.picture} alt="" />
                <AvatarFallback className="text-[10px]">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Link>
          </UserHoverCard>

          {lineActive && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label={`Collapse ${displayName}'s replies`}
              className="group mt-1 flex w-full flex-1 justify-center py-1"
            >
              <span className="w-px flex-1 rounded-full bg-border transition-colors group-hover:bg-primary" />
            </button>
          )}
        </div>

        <div className={cn('min-w-0 flex-1', lineActive ? 'pb-2' : 'pb-3')}>
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
              {timeAgo(event)}
            </Link>
          </div>

          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <ChevronRight className="h-3 w-3" />
              Show this reply
              {total > 0 && ` and ${total} more`}
            </button>
          ) : (
            <>
              <div className="mt-1 text-[15px]">
                {contentWarning ? (
                  <ContentWarning reason={contentWarning.reason}>
                    <NoteBody event={event} />
                  </ContentWarning>
                ) : (
                  <NoteBody event={event} />
                )}
              </div>

              <div className="-ml-1.5 mt-1.5 flex items-center gap-1">
                <RowAction
                  icon={MessageCircle}
                  label="Reply"
                  count={children.length}
                  active={replying}
                  onClick={() => setReplying((open) => !open)}
                />
                <RowAction
                  icon={Heart}
                  label={isLiked ? 'Remove reaction' : 'Like'}
                  count={likeCount}
                  active={isLiked}
                  fillWhenActive
                  disabled={isLiking}
                  onClick={handleLike}
                />
              </div>

              {replying && (
                <ThreadComposer
                  parent={event}
                  replyingToName={displayName}
                  autoFocus
                  onDone={() => setReplying(false)}
                  onCancel={() => setReplying(false)}
                  className="mt-2"
                />
              )}

              {/* The thread continues on its own page rather than indenting
                  further, which is what makes unbounded depth readable */}
              {atDepthLimit && children.length > 0 && (
                <Link
                  to={`/${noteId}`}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <ChevronRight className="h-3 w-3" />
                  Show this thread
                  {total > 0 && ` · ${total} more ${total === 1 ? 'reply' : 'replies'}`}
                </Link>
              )}
            </>
          )}
        </div>
      </div>

      {showsSubtree && (
        <ul className="ml-[18px] border-l border-border pl-3 sm:pl-[18px]">
          {visible.map((child) => (
            <ThreadReply key={child.event.id} node={child} depth={depth + 1} />
          ))}

          {trimmed && (
            <li className="py-1.5 pl-3">
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Show {children.length - REPLIES_BEFORE_COLLAPSE} more{' '}
                {children.length - REPLIES_BEFORE_COLLAPSE === 1
                  ? 'reply'
                  : 'replies'}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** Relative time, tolerant of relays that serve a nonsense `created_at`. */
function timeAgo(event: NostrEvent): string {
  const timestamp = event.created_at * 1000;
  if (!timestamp || timestamp <= 0 || timestamp > Date.now() + 86_400_000) {
    return 'unknown';
  }
  try {
    return formatAge(timestamp);
  } catch {
    return 'unknown';
  }
}

function RowAction({
  icon: Icon,
  label,
  count,
  active,
  disabled,
  fillWhenActive,
  onClick,
}: {
  icon: typeof Heart;
  label: string;
  count?: number;
  active?: boolean;
  disabled?: boolean;
  fillWhenActive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1 rounded-full px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40',
        active && 'text-primary'
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', active && fillWhenActive && 'fill-current')} />
      {!!count && <span className="tabular-nums">{count}</span>}
    </button>
  );
}
