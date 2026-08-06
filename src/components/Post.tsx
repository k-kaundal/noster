import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { useReactions } from '@/hooks/useReactions';
import { useReposts } from '@/hooks/useReposts';
import { useReplies } from '@/hooks/useReplies';
import { useEvent } from '@/hooks/useEvent';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBookmarks } from '@/hooks/useBookmarks';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { NoteBody } from '@/components/notes/NoteBody';
import { ReplyDialog } from '@/components/ReplyDialog';
import { RepliesSection } from '@/components/RepliesSection';
import { ZapDialog } from '@/components/ZapDialog';
import { QuotedNote } from '@/components/QuotedNote';
import { ContentWarning } from '@/components/ContentWarning';
import { QuoteDialog } from '@/components/QuoteDialog';
import {
  getContentWarning,
  getInlineQuoteId,
  getQuotedEventId,
} from '@/lib/note';
import {
  BadgeCheck,
  Bookmark,
  Copy,
  ExternalLink,
  Heart,
  Link2,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Quote,
  Repeat2,
  Share2,
  Zap,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { nip19 } from 'nostr-tools';
import { cn } from '@/lib/utils';

interface PostProps {
  event: NostrEvent;
  showReplies?: boolean;
  /** Renders without the card chrome, for embedding inside another post. */
  embedded?: boolean;
  className?: string;
}

/** Compact relative timestamp, tolerant of relays that serve bad `created_at`. */
function useTimeAgo(createdAt: number) {
  const timestamp = createdAt * 1000;
  if (!timestamp || timestamp <= 0 || timestamp > Date.now() + 86_400_000) {
    return 'unknown time';
  }
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return 'unknown time';
  }
}

function formatCount(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${count}`;
}

export function Post({
  event,
  showReplies = true,
  embedded = false,
  className,
}: PostProps) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [zapOpen, setZapOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);

  const { isLiked, likeCount, like, isLiking } = useReactions(event.id);
  const { isReposted, repostCount, repost, isReposting } = useReposts(event.id);
  const { replyCount } = useReplies(event.id);
  const { isBookmarked, toggle: toggleBookmark, isToggling } = useBookmarks();

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const username = metadata?.name || genUserName(event.pubkey);
  const npub = nip19.npubEncode(event.pubkey);
  const noteId = nip19.noteEncode(event.id);
  const timeAgo = useTimeAgo(event.created_at);

  const isRepost = event.kind === 6 || event.kind === 16;
  const isReply = !isRepost && event.tags.some(([name]) => name === 'e');
  const isOwnPost = user?.pubkey === event.pubkey;
  const canZap = !!(metadata?.lud06 || metadata?.lud16) && !isOwnPost;

  // Reposts usually inline the original as JSON, but some clients send an
  // empty body and only reference the note through its `e` tag.
  const embeddedRepost = isRepost ? parseEmbeddedEvent(event.content) : null;
  const repostTargetId = isRepost
    ? event.tags.find(([name]) => name === 'e')?.[1]
    : undefined;
  const { data: fetchedRepost } = useEvent(
    !embeddedRepost && repostTargetId ? repostTargetId : ''
  );
  const repostedEvent = embeddedRepost ?? fetchedRepost ?? null;

  const contentWarning = getContentWarning(event);
  // A `q` tag is authoritative; otherwise fall back to an inline nostr: URI
  const quotedId = getQuotedEventId(event) ?? getInlineQuoteId(event.content);

  const postUrl = `${window.location.origin}/${noteId}`;

  const requireLogin = (action: string) => {
    toast({
      title: 'Login required',
      description: `You must be logged in to ${action}.`,
      variant: 'destructive',
    });
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: 'Copied', description: `${label} copied to clipboard.` });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Your browser blocked clipboard access.',
        variant: 'destructive',
      });
    }
  };

  const handleReply = () => {
    if (!user) return requireLogin('reply');
    setReplyDialogOpen(true);
  };

  const handleRepost = async () => {
    if (!user) return requireLogin('repost');
    try {
      await repost({ targetEvent: event });
      toast({ title: 'Reposted', description: 'Shared to your followers.' });
    } catch (error) {
      toast({
        title: 'Repost failed',
        description: (error as Error)?.message || 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleLike = async () => {
    if (!user) return requireLogin('react');
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

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Note by ${displayName}`,
          text: event.content.slice(0, 120),
          url: postUrl,
        });
        return;
      } catch (error) {
        // A cancelled share sheet is not an error worth reporting
        if ((error as Error)?.name === 'AbortError') return;
      }
    }
    await copy(postUrl, 'Link');
  };

  const body = (
    <article className={cn('flex gap-3 p-4', embedded && 'p-3')}>
      <Link to={`/${npub}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
        <Avatar
          className={cn(
            'transition-transform hover:scale-105',
            embedded ? 'h-8 w-8' : 'h-10 w-10'
          )}
        >
          <AvatarImage src={metadata?.picture} alt="" />
          <AvatarFallback className="text-xs">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-center gap-x-1.5">
              <Link
                to={`/${npub}`}
                className="truncate font-semibold hover:underline"
              >
                {displayName}
              </Link>
              {metadata?.nip05 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <BadgeCheck
                      className="h-4 w-4 shrink-0 text-primary"
                      aria-label="Verified NIP-05 address"
                    />
                  </TooltipTrigger>
                  <TooltipContent>{metadata.nip05}</TooltipContent>
                </Tooltip>
              )}
              <span className="truncate text-muted-foreground">@{username}</span>
              <span className="text-muted-foreground" aria-hidden="true">
                ·
              </span>
              <Link
                to={`/${noteId}`}
                className="shrink-0 text-muted-foreground hover:underline"
              >
                {timeAgo}
              </Link>
            </div>

            {isReply && (
              <Link
                to={`/${noteId}`}
                className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              >
                <MessageCircle className="h-3 w-3" />
                Replying to a thread
              </Link>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-1 h-8 w-8 shrink-0 text-muted-foreground"
                aria-label="More actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => copy(postUrl, 'Link')}>
                <Link2 className="mr-2 h-4 w-4" />
                Copy link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copy(noteId, 'Note ID')}>
                <Copy className="mr-2 h-4 w-4" />
                Copy note ID
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copy(npub, 'Public key')}>
                <Copy className="mr-2 h-4 w-4" />
                Copy author npub
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isToggling}
                onClick={() => {
                  if (!user) return requireLogin('bookmark');
                  toggleBookmark(event);
                }}
              >
                <Bookmark
                  className={cn(
                    'mr-2 h-4 w-4',
                    isBookmarked(event.id) && 'fill-current text-primary'
                  )}
                />
                {isBookmarked(event.id) ? 'Remove bookmark' : 'Bookmark'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a
                  href={`https://njump.me/${noteId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open on njump
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-2 text-[15px]">
          {isRepost ? (
            repostedEvent ? (
              /* One level of embedding only, so a repost chain can't recurse */
              embedded ? (
                <Link
                  to={`/${nip19.noteEncode(repostedEvent.id)}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View the reposted note
                </Link>
              ) : (
                <Card className="overflow-hidden bg-muted/30">
                  <Post event={repostedEvent} showReplies={false} embedded />
                </Card>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                The reposted note could not be loaded.
              </p>
            )
          ) : contentWarning ? (
            <ContentWarning reason={contentWarning.reason}>
              <NoteBody event={event} />
            </ContentWarning>
          ) : (
            <NoteBody event={event} />
          )}

          {quotedId && !isRepost && (
            <QuotedNote eventId={quotedId} className="mt-3" />
          )}
        </div>

        {!embedded && (
          <div className="-ml-2 mt-3 flex items-center justify-between gap-1 sm:justify-start sm:gap-2">
            <ActionButton
              icon={MessageCircle}
              label="Reply"
              count={replyCount}
              tone="reply"
              onClick={handleReply}
            />
            <ActionButton
              icon={Repeat2}
              label={isReposted ? 'Reposted' : 'Repost'}
              count={repostCount}
              tone="repost"
              active={isReposted}
              busy={isReposting}
              onClick={handleRepost}
            />
            <ActionButton
              icon={Heart}
              label={isLiked ? 'Remove reaction' : 'Like'}
              count={likeCount}
              tone="like"
              active={isLiked}
              busy={isLiking}
              fillWhenActive
              onClick={handleLike}
            />
            <ActionButton
              icon={Zap}
              label={
                isOwnPost
                  ? "You can't zap your own note"
                  : canZap
                    ? 'Zap'
                    : 'Author has no Lightning address'
              }
              tone="zap"
              disabled={!canZap}
              onClick={() => {
                if (!user) return requireLogin('zap');
                setZapOpen(true);
              }}
            />
            <ActionButton
              icon={Quote}
              label="Quote"
              tone="repost"
              onClick={() => {
                if (!user) return requireLogin('quote');
                setQuoteOpen(true);
              }}
            />
            <ActionButton
              icon={Share2}
              label="Share"
              tone="reply"
              onClick={handleShare}
            />
          </div>
        )}

        {!embedded && showReplies && replyCount > 0 && (
          <button
            type="button"
            onClick={() => setRepliesOpen((open) => !open)}
            className="mt-2 text-xs font-medium text-primary hover:underline"
            aria-expanded={repliesOpen}
          >
            {repliesOpen
              ? 'Hide replies'
              : `Show ${formatCount(replyCount)} ${replyCount === 1 ? 'reply' : 'replies'}`}
          </button>
        )}
      </div>
    </article>
  );

  if (embedded) return body;

  return (
    <>
      <Card
        className={cn(
          'overflow-hidden shadow-card transition-shadow duration-200 hover:shadow-card-hover',
          className
        )}
      >
        {isRepost && (
          <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <Repeat2 className="h-3.5 w-3.5 text-repost" />
            <Link to={`/${npub}`} className="font-medium hover:underline">
              {displayName}
            </Link>
            <span>reposted</span>
          </div>
        )}

        {body}

        {showReplies && repliesOpen && (
          <RepliesSection eventId={event.id} className="border-t px-4 py-3" />
        )}
      </Card>

      <ReplyDialog
        open={replyDialogOpen}
        onOpenChange={setReplyDialogOpen}
        replyingTo={event}
      />
      <ZapDialog target={event} open={zapOpen} onOpenChange={setZapOpen} />
      <QuoteDialog
        open={quoteOpen}
        onOpenChange={setQuoteOpen}
        quoting={event}
      />
    </>
  );
}

interface ActionButtonProps {
  icon: typeof Heart;
  label: string;
  count?: number;
  tone: 'reply' | 'repost' | 'like' | 'zap';
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
  fillWhenActive?: boolean;
  onClick: () => void;
}

const TONE_CLASSES = {
  reply: 'hover:text-reply hover:bg-reply/10',
  repost: 'hover:text-repost hover:bg-repost/10',
  like: 'hover:text-like hover:bg-like/10',
  zap: 'hover:text-zap hover:bg-zap/10',
} as const;

const ACTIVE_CLASSES = {
  reply: 'text-reply',
  repost: 'text-repost',
  like: 'text-like',
  zap: 'text-zap',
} as const;

function ActionButton({
  icon: Icon,
  label,
  count,
  tone,
  active,
  busy,
  disabled,
  fillWhenActive,
  onClick,
}: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={busy || disabled}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'press group flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            TONE_CLASSES[tone],
            active && ACTIVE_CLASSES[tone]
          )}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Icon
              className={cn(
                'h-4 w-4 transition-transform group-active:scale-90',
                active && fillWhenActive && 'fill-current'
              )}
            />
          )}
          {count !== undefined && count > 0 && (
            <span className="tabular-nums">{formatCount(count)}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Kind 6 reposts carry the original event as JSON in `content`. */
function parseEmbeddedEvent(content: string): NostrEvent | null {
  if (!content.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(content) as NostrEvent;
    return parsed && typeof parsed.id === 'string' && typeof parsed.content === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}
