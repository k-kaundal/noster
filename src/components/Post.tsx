import { Suspense, lazy, useState } from 'react';
import { Link } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { useReactions } from '@/hooks/useReactions';
import { useReposts } from '@/hooks/useReposts';
import { useReplies } from '@/hooks/useReplies';
import { useZapSummary } from '@/hooks/useZapSummary';
import { useQuickZap } from '@/hooks/useQuickZap';
import { useHoldGesture } from '@/hooks/useHoldGesture';
import { useEvent } from '@/hooks/useEvent';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBookmarks } from '@/hooks/useBookmarks';
import { useMuteList } from '@/hooks/useMuteList';
import { useMutePrivacy } from '@/hooks/useMutePrivacy';
import { useDeleteEvent } from '@/hooks/useDeleteEvent';
import { useToast } from '@/hooks/useToast';
import { useOnceOpened } from '@/hooks/useDeferredDialog';
import { genUserName } from '@/lib/genUserName';
import { handleFor } from '@/lib/handle';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserHoverCard } from '@/components/UserHoverCard';
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

/**
 * The dialogs a note can open, fetched only when one is.
 *
 * Every note in the feed mounts all four. Loading them eagerly meant the
 * drawer library, the QR renderer and three composers had to be parsed before
 * the first note could appear, for screens most readers never open.
 */
const ReplyDialog = lazy(() =>
  import('@/components/ReplyDialog').then((m) => ({ default: m.ReplyDialog }))
);
const ZapActivityDialog = lazy(() =>
  import('@/components/ZapActivityDialog').then((m) => ({
    default: m.ZapActivityDialog,
  }))
);
const ZapDialog = lazy(() =>
  import('@/components/ZapDialog').then((m) => ({ default: m.ZapDialog }))
);
const QuoteDialog = lazy(() =>
  import('@/components/QuoteDialog').then((m) => ({ default: m.QuoteDialog }))
);
const ReportDialog = lazy(() =>
  import('@/components/ReportDialog').then((m) => ({ default: m.ReportDialog }))
);
/*
 * Split out for its own reason: it pulls in the canvas renderer, which is
 * dead weight in a feed where almost nobody shares almost any given note.
 */
const ShareNoteDialog = lazy(() =>
  import('@/components/ShareNoteDialog').then((m) => ({
    default: m.ShareNoteDialog,
  }))
);
import { RepliesSection } from '@/components/RepliesSection';
import { QuotedNote } from '@/components/QuotedNote';
import { MaybeWarned } from '@/components/ContentWarning';
import { PowBadge } from '@/components/PowBadge';
import { AvatarRing } from '@/components/AvatarRing';
import { formatTimeLeft, secondsUntilExpiry } from '@/lib/expiration';
import { ReactionChips, ReactionPicker } from '@/components/ReactionPicker';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  getContentWarning,
  getInlineQuoteId,
  getQuotedEventId,
} from '@/lib/note';
import {
  BadgeCheck,
  Bookmark,
  Clock,
  Copy,
  Flag,
  Trash2,
  VolumeX,
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
import { timeAgo as formatAge } from '@/lib/time';
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
    return formatAge(timestamp);
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
  const [zapActivityOpen, setZapActivityOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Each stays mounted after its first open, so closing keeps the exit
  // animation and anything half-typed
  const replyMounted = useOnceOpened(replyDialogOpen);
  const zapMounted = useOnceOpened(zapOpen);
  const zapActivityMounted = useOnceOpened(zapActivityOpen);
  const quoteMounted = useOnceOpened(quoteOpen);
  const reportMounted = useOnceOpened(reportOpen);
  const shareMounted = useOnceOpened(shareOpen);

  const { isLiked, likeCount, like, isLiking, groups } = useReactions(event.id);
  const { deleteEvents, isDeleting } = useDeleteEvent();
  const { isReposted, repostCount, repost, isReposting } = useReposts(event.id);
  const { replyCount } = useReplies(event.id);
  /**
   * What the note earned. Free: the receipts arrive in the same batched query
   * that already fetches replies, reposts and reactions — they were simply
   * never read, which is why this was the one action in the row with no
   * number on it.
   */
  const zapSummary = useZapSummary(event);

  /**
   * One tap sends, when somebody has turned that on and it can go through.
   *
   * The dialog is never taken away: a long press opens it, and so does any
   * state where an instant send cannot happen — no wallet, not enough in it —
   * because an invoice can still be paid from a phone.
   */
  const quickZap = useQuickZap(event);
  const { isBookmarked, toggle: toggleBookmark, isToggling } = useBookmarks();
  const { isUserMuted, muteUser, unmuteUser, canBePrivate } = useMuteList();
  const { isPrivate } = useMutePrivacy();

  // Private only when the user asked for it and the signer can encrypt
  const mutePrivately = isPrivate && canBePrivate;

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const username = handleFor(metadata, event.pubkey);
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
  const timeLeft = secondsUntilExpiry(event);
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

  /**
   * Opens the share screen rather than the browser's sheet.
   *
   * The sheet only carries a link, and a link to a note previews as nothing —
   * every crawler is served the same `index.html`, so a note posted to X or
   * Facebook shows the site's front door whatever was shared. The screen
   * offers a picture of the note, which every one of those places renders
   * correctly because none of them is rendering it.
   */
  const handleShare = () => setShareOpen(true);

  const body = (
    <article className={cn('p-4 sm:p-5', embedded && 'p-3')}>
      {/* Identity is a row; the note below it is not trapped in the column
          beside the avatar, which on a phone costs a quarter of the width */}
      <div className="flex items-start gap-2.5 sm:gap-3">
        <UserHoverCard pubkey={event.pubkey}>
          <Link
            to={`/${npub}`}
            className="shrink-0"
            tabIndex={-1}
            aria-hidden="true"
          >
            {/*
              Free to draw here: the ring is read from the same metadata this
              avatar already loaded, so a feed full of them costs no extra
              lookups.
            */}
            <AvatarRing metadata={metadata as Record<string, unknown>}>
              <Avatar
                className={cn(
                  'transition-opacity hover:opacity-90',
                  embedded ? 'h-7 w-7 sm:h-8 sm:w-8' : 'h-9 w-9 sm:h-10 sm:w-10',
                )}
              >
                <AvatarImage src={metadata?.picture} alt="" />
                <AvatarFallback className="text-xs">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </AvatarRing>
          </Link>
        </UserHoverCard>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5">
            <UserHoverCard pubkey={event.pubkey}>
              <Link
                to={`/${npub}`}
                className="truncate font-semibold text-sm hover:underline"
              >
                {displayName}
              </Link>
            </UserHoverCard>
            {metadata?.nip05 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <BadgeCheck
                    className="h-3.5 w-3.5 shrink-0 text-primary"
                    aria-label="Verified NIP-05 address"
                  />
                </TooltipTrigger>
                <TooltipContent>{metadata.nip05}</TooltipContent>
              </Tooltip>
            )}
            <span className="truncate text-xs text-muted-foreground">
              @{username}
            </span>
            <span className="text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <Link
              to={`/${noteId}`}
              className="shrink-0 text-xs text-muted-foreground hover:underline"
            >
              {timeAgo}
            </Link>

            {/* Only appears on notes that carry meaningful proof of work */}
            <PowBadge event={event} className="shrink-0 text-[10px]" />
          </div>

          {isReply && <ReplyingTo event={event} noteId={noteId} />}
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
                  isBookmarked(event.id) && 'fill-current text-primary',
                )}
              />
              {isBookmarked(event.id) ? 'Remove bookmark' : 'Bookmark'}
            </DropdownMenuItem>
            {/* Muting your own notes would just hide your timeline */}
            {user && !isOwnPost && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() =>
                  isUserMuted(event.pubkey)
                    ? unmuteUser(event.pubkey)
                    : muteUser(event.pubkey, { private: mutePrivately })
                }
              >
                <VolumeX className="mr-2 h-4 w-4" />
                {isUserMuted(event.pubkey)
                  ? `Unmute ${displayName}`
                  : `Mute ${displayName}`}
              </DropdownMenuItem>
            )}
            {user && !isOwnPost && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setReportOpen(true)}
              >
                <Flag className="mr-2 h-4 w-4" />
                Report
              </DropdownMenuItem>
            )}
            {isOwnPost && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete post
              </DropdownMenuItem>
            )}
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

      {timeLeft !== null && (
        /*
          NIP-40. Shown because the author asked for this note to stop being
          served, and a reader deciding whether to reply deserves to know it
          is on a clock.
        */
        <div
          className={cn(
            'mt-2 flex items-center gap-1.5 text-xs text-muted-foreground',
            !embedded && 'sm:ml-[3.25rem]'
          )}
        >
          <Clock className="h-3 w-3" />
          {formatTimeLeft(timeLeft)}
        </div>
      )}

      <div className={cn('mt-2 text-[15px]', !embedded && 'sm:ml-[3.25rem]')}>
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
        ) : (
          <MaybeWarned event={event} warning={contentWarning}>
            <NoteBody event={event} />
          </MaybeWarned>
        )}

        {quotedId && !isRepost && (
          <QuotedNote eventId={quotedId} className="mt-3" />
        )}
      </div>

      {!embedded && (
        <div className="mt-4 flex flex-wrap items-center gap-1 border-t pt-3 sm:ml-[3.25rem] sm:gap-2">
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
            /*
             * The amount is in the label whenever a tap will send it. A
             * button that spends money without saying how much is the thing
             * one-tap must never become, and this is where somebody checks
             * before pressing.
             */
            label={
              isOwnPost
                ? "You can't zap your own note"
                : !canZap
                  ? 'Author has no Lightning address'
                  : quickZap.oneTap
                    ? `Zap ${quickZap.amount.toLocaleString()} sats — hold to choose`
                    : 'Zap'
            }
            count={zapSummary.totalSats || undefined}
            tone="zap"
            disabled={!canZap}
            busy={quickZap.isSending}
            onClick={() => {
              if (!user) return requireLogin('zap');
              if (!quickZap.oneTap) return setZapOpen(true);

              // Falls back rather than leaving a paying button that did
              // nothing, which is the worst failure available here
              void quickZap.send().then((sent) => {
                if (!sent) setZapOpen(true);
              });
            }}
            onHold={() => {
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
          <ReactionPicker event={event} />
          <ActionButton
            icon={Share2}
            label="Share"
            tone="reply"
            onClick={handleShare}
          />

          {/*
            Who paid, on its own tap target.
            
            The button beside it sends money and this one only looks, so they
            cannot share a target — and the count sits here rather than beside
            the total because "3,420 sats" twice in one row says nothing the
            first one did not.
          */}
          {zapSummary.count > 0 && (
            <button
              type="button"
              onClick={() => setZapActivityOpen(true)}
              className="ml-auto rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-zap/10 hover:text-zap"
            >
              {zapSummary.count === 1 ? '1 zap' : `${zapSummary.count} zaps`}
            </button>
          )}
        </div>
      )}

      {/* Emoji left by others, beyond the plain like counted above */}
      {!embedded && (
        <ReactionChips
          event={event}
          groups={groups}
          className="mt-2 sm:ml-[3.25rem]"
        />
      )}

      {!embedded && showReplies && replyCount > 0 && (
        <button
          type="button"
          onClick={() => setRepliesOpen((open) => !open)}
          className="mt-2 text-xs font-medium text-primary hover:underline sm:ml-[3.25rem]"
          aria-expanded={repliesOpen}
        >
          {repliesOpen
            ? 'Hide replies'
            : `Show ${formatCount(replyCount)} ${replyCount === 1 ? 'reply' : 'replies'}`}
        </button>
      )}
    </article>
  );

  if (embedded) return body;

  return (
    <>
      <Card
        className={cn(
          // Off-screen rows skip layout and paint in a long feed
          'content-auto overflow-hidden hover-lift border transition-all hover:shadow-sm',
          className
        )}
      >
        {isRepost && (
          <div className="flex items-center gap-2 border-b bg-repost/5 px-4 py-2.5 text-xs text-repost font-medium">
            <Repeat2 className="h-4 w-4 shrink-0 text-repost/80" />
            <Link to={`/${npub}`} className="hover:underline">
              {displayName}
            </Link>
            <span className="text-repost/70">reposted</span>
          </div>
        )}

        {body}

        {showReplies && repliesOpen && (
          <RepliesSection eventId={event.id} className="border-t px-4 py-3" />
        )}
      </Card>

      <Suspense fallback={null}>
        {replyMounted && (
          <ReplyDialog
            open={replyDialogOpen}
            onOpenChange={setReplyDialogOpen}
            replyingTo={event}
          />
        )}
        {zapMounted && (
          <ZapDialog target={event} open={zapOpen} onOpenChange={setZapOpen} />
        )}
        {zapActivityMounted && (
          <ZapActivityDialog
            summary={zapSummary}
            open={zapActivityOpen}
            onOpenChange={setZapActivityOpen}
          />
        )}
        {quoteMounted && (
          <QuoteDialog
            open={quoteOpen}
            onOpenChange={setQuoteOpen}
            quoting={event}
          />
        )}
        {reportMounted && (
          <ReportDialog
            open={reportOpen}
            onOpenChange={setReportOpen}
            pubkey={event.pubkey}
            displayName={displayName}
            event={event}
          />
        )}
        {shareMounted && (
          <ShareNoteDialog
            event={event}
            url={postUrl}
            open={shareOpen}
            onOpenChange={setShareOpen}
          />
        )}
      </Suspense>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This asks relays to drop it. Most honour the request, but a
              deletion cannot be enforced — anyone who already has a copy, and
              any relay that never receives the request, keeps it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={() => deleteEvents({ events: [event] })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Request deletion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Who a reply is answering, named rather than described.
 *
 * The pubkey comes from the reply's own tags, so this costs no extra request —
 * the alternative is fetching the parent note just to learn its author, which
 * is a round trip per reply in the feed.
 */
function ReplyingTo({ event, noteId }: { event: NostrEvent; noteId: string }) {
  // NIP-10 puts the parent's author on the reply tag; the first `p` tag is the
  // long-standing convention for the same thing
  const parentPubkey =
    event.tags.find(([name, , , marker]) => name === 'e' && marker === 'reply')?.[4] ||
    event.tags.find(([name]) => name === 'p')?.[1];

  const author = useAuthor(parentPubkey || '');
  const metadata = author.data?.metadata;

  return (
    <Link
      to={`/${noteId}`}
      className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
    >
      <MessageCircle className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span>
        {/* The handle rather than the display name: "Replying to @Keen
            Eagle" names nobody, since that label is invented for anyone
            without a profile and two strangers get the same one. */}
        {parentPubkey
          ? `Replying to @${handleFor(metadata, parentPubkey)}`
          : 'Replying to a thread'}
      </span>
    </Link>
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
  /**
   * A long press, where one exists.
   *
   * The zap button pays on a tap once somebody turns that on, so the way to
   * choose a different amount has to be somewhere — and holding is the
   * gesture every other client already uses for it.
   */
  onHold?: () => void;
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
  onHold,
}: ActionButtonProps) {
  const hold = useHoldGesture({ onTap: onClick, onHold });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          {...hold}
          disabled={busy || disabled}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            'press group flex min-h-9 items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50',
            'hover:scale-110 active:scale-95',
            TONE_CLASSES[tone],
            active && ACTIVE_CLASSES[tone],
            (busy || disabled) && 'pointer-events-none'
          )}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Icon
              className={cn(
                'h-4 w-4 shrink-0 transition-transform duration-150',
                active && fillWhenActive && 'fill-current'
              )}
            />
          )}
          {count !== undefined && count > 0 && (
            <span className="tabular-nums text-xs font-semibold">{formatCount(count)}</span>
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
