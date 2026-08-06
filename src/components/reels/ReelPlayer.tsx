import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  BadgeCheck,
  Heart,
  MessageCircle,
  Play,
  Repeat2,
  Share2,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { useAuthor } from '@/hooks/useAuthor';
import { useReactions } from '@/hooks/useReactions';
import { useReposts } from '@/hooks/useReposts';
import { useReplies } from '@/hooks/useReplies';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { parseVideoEvent } from '@/lib/video';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { FollowButton } from '@/components/FollowButton';
import { ReplyDialog } from '@/components/ReplyDialog';
import { ZapDialog } from '@/components/ZapDialog';
import { cn } from '@/lib/utils';

interface ReelPlayerProps {
  event: NostrEvent;
  /** Only the reel in view plays; the rest stay paused to save bandwidth. */
  isActive: boolean;
  muted: boolean;
  onToggleMute: () => void;
}

function formatCount(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count > 0 ? `${count}` : '';
}

export function ReelPlayer({
  event,
  isActive,
  muted,
  onToggleMute,
}: ReelPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [zapOpen, setZapOpen] = useState(false);

  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const { isLiked, likeCount, like, isLiking } = useReactions(event.id);
  const { isReposted, repostCount, repost, isReposting } = useReposts(event.id);
  const { replyCount } = useReplies(event.id);

  const video = parseVideoEvent(event);
  const source = video.variants[0];
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const npub = nip19.npubEncode(event.pubkey);
  const noteId = nip19.noteEncode(event.id);
  const canZap = !!(metadata?.lud06 || metadata?.lud16) &&
    user?.pubkey !== event.pubkey;

  const gated = video.contentWarning !== null && !revealed;

  // Play only while this reel is the one on screen
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    if (isActive && !gated) {
      element.play().then(
        () => setIsPlaying(true),
        () => setIsPlaying(false) // Autoplay can be refused; the tap target remains
      );
    } else {
      element.pause();
      setIsPlaying(false);
      if (!isActive) element.currentTime = 0;
    }
  }, [isActive, gated]);

  const togglePlay = () => {
    const element = videoRef.current;
    if (!element) return;

    if (element.paused) {
      element.play().then(
        () => setIsPlaying(true),
        () => setIsPlaying(false)
      );
    } else {
      element.pause();
      setIsPlaying(false);
    }
  };

  const requireLogin = (action: string) => {
    toast({
      title: 'Login required',
      description: `You must be logged in to ${action}.`,
      variant: 'destructive',
    });
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/${noteId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: video.title ?? 'Nostr reel', url });
        return;
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied' });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  return (
    <div className="relative h-full w-full snap-start snap-always overflow-hidden rounded-none bg-black sm:rounded-2xl">
      {source && (
        <video
          ref={videoRef}
          src={source.url}
          poster={source.image}
          loop
          playsInline
          muted={muted}
          preload={isActive ? 'auto' : 'none'}
          aria-label={video.alt ?? video.title ?? 'Short video'}
          className={cn(
            'h-full w-full object-contain transition-[filter] duration-200',
            gated && 'blur-2xl'
          )}
          onClick={togglePlay}
        />
      )}

      {/* Tap-to-play affordance, shown only while paused */}
      {!gated && !isPlaying && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play"
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            <Play className="ml-1 h-7 w-7 fill-white text-white" />
          </span>
        </button>
      )}

      {gated && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 p-6 text-center">
          <p className="font-medium text-white">Sensitive content</p>
          {video.contentWarning && (
            <p className="text-sm text-white/70">{video.contentWarning}</p>
          )}
          <Button size="sm" variant="secondary" onClick={() => setRevealed(true)}>
            Show anyway
          </Button>
        </div>
      )}

      {/* Mute toggle */}
      {!gated && (
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}

      {/* Action rail */}
      <div className="absolute bottom-24 right-3 flex flex-col items-center gap-4 sm:bottom-6">
        <ReelAction
          icon={Heart}
          label="Like"
          count={likeCount}
          active={isLiked}
          disabled={isLiking}
          onClick={async () => {
            if (!user) return requireLogin('react');
            try {
              await like({ targetEvent: event });
            } catch {
              toast({ title: 'Reaction failed', variant: 'destructive' });
            }
          }}
        />
        <ReelAction
          icon={MessageCircle}
          label="Comment"
          count={replyCount}
          onClick={() => {
            if (!user) return requireLogin('reply');
            setReplyOpen(true);
          }}
        />
        <ReelAction
          icon={Repeat2}
          label="Repost"
          count={repostCount}
          active={isReposted}
          disabled={isReposting}
          onClick={async () => {
            if (!user) return requireLogin('repost');
            try {
              await repost({ targetEvent: event });
              toast({ title: 'Reposted' });
            } catch {
              toast({ title: 'Repost failed', variant: 'destructive' });
            }
          }}
        />
        <ReelAction
          icon={Zap}
          label="Zap"
          disabled={!canZap}
          onClick={() => {
            if (!user) return requireLogin('zap');
            setZapOpen(true);
          }}
        />
        <ReelAction icon={Share2} label="Share" onClick={handleShare} />
      </div>

      {/* Author and caption */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pb-24 pr-16 sm:pb-6">
        <div className="pointer-events-auto space-y-2">
          <div className="flex items-center gap-2">
            <Link to={`/${npub}`} className="shrink-0">
              <Avatar className="h-9 w-9 border-2 border-white/80">
                <AvatarImage src={metadata?.picture} alt="" />
                <AvatarFallback className="text-xs">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Link>
            <Link
              to={`/${npub}`}
              className="truncate text-sm font-semibold text-white hover:underline"
            >
              {displayName}
            </Link>
            {metadata?.nip05 && (
              <BadgeCheck className="h-4 w-4 shrink-0 text-white" aria-hidden="true" />
            )}
            <FollowButton
              pubkey={event.pubkey}
              size="sm"
              className="ml-1 h-7 border-white/40 bg-white/10 text-white hover:bg-white/20"
            />
          </div>

          {video.title && (
            <p className="line-clamp-2 text-sm font-medium text-white">
              {video.title}
            </p>
          )}
          {event.content && (
            <p className="line-clamp-2 text-sm text-white/80">{event.content}</p>
          )}

          {video.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {video.hashtags.slice(0, 4).map((tag) => (
                <Link
                  key={tag}
                  to={`/t/${encodeURIComponent(tag.toLowerCase())}`}
                  className="text-xs font-medium text-white/90 hover:underline"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <ReplyDialog open={replyOpen} onOpenChange={setReplyOpen} replyingTo={event} />
      <ZapDialog target={event} open={zapOpen} onOpenChange={setZapOpen} />
    </div>
  );
}

function ReelAction({
  icon: Icon,
  label,
  count,
  active,
  disabled,
  onClick,
}: {
  icon: typeof Heart;
  label: string;
  count?: number;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className="flex flex-col items-center gap-1 text-white transition-transform active:scale-90 disabled:opacity-40"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
        <Icon className={cn('h-5 w-5', active && 'fill-current text-like')} />
      </span>
      {count !== undefined && count > 0 && (
        <span className="text-[11px] font-medium tabular-nums">
          {formatCount(count)}
        </span>
      )}
    </button>
  );
}
