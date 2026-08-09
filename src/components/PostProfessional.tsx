/**
 * Professional enhanced Post component with improved visual hierarchy
 * Provides better spacing, typography, and interaction feedback
 */

import { Suspense, lazy, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostr } from '@nostrify/react';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Heart, MessageCircle, Repeat2, Share, Loader2 } from 'lucide-react';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface PostProfessionalProps {
  event: NostrEvent;
  showReplyThread?: boolean;
  className?: string;
}

/**
 * Professional post card with enhanced visual hierarchy
 */
export function PostProfessional({
  event,
  showReplyThread = false,
  className,
}: PostProfessionalProps) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const [isLiked, setIsLiked] = useState(false);
  const { nostr } = useNostr();
  const [engagement, setEngagement] = useState({ replies: 0, reposts: 0, likes: 0 });
  const [isLoadingEngagement, setIsLoadingEngagement] = useState(true);

  const date = new Date(event.created_at * 1000);
  const timeAgo = getTimeAgo(date);

  // Fetch engagement metrics
  useEffect(() => {
    const fetchEngagement = async () => {
      try {
        const signal = AbortSignal.timeout(2000);

        // Fetch reactions (likes and other reactions)
        const reactions = await nostr.query(
          [{ kinds: [7], '#e': [event.id], limit: 100 }],
          { signal }
        ).catch(() => []);

        // Fetch reposts (kind 6 and 16)
        const reposts = await nostr.query(
          [{ kinds: [6, 16], '#e': [event.id], limit: 100 }],
          { signal }
        ).catch(() => []);

        // Fetch replies (posts with 'e' tag pointing to this post)
        const replies = await nostr.query(
          [{ kinds: [1], '#e': [event.id], limit: 100 }],
          { signal }
        ).catch(() => []);

        setEngagement({
          likes: reactions.length,
          reposts: reposts.length,
          replies: replies.length,
        });
      } catch (error) {
        console.error('Failed to fetch engagement:', error);
      } finally {
        setIsLoadingEngagement(false);
      }
    };

    fetchEngagement();
  }, [event.id, nostr]);

  return (
    <Card
      className={cn(
        'group overflow-hidden rounded-xl border-0 bg-card hover:bg-card/95',
        'shadow-sm hover:shadow-md transition-all duration-200',
        'border border-border/50',
        className
      )}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/30">
        <div className="flex items-start justify-between gap-3">
          {/* Author Info */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar className="h-12 w-12 shrink-0 border-2 border-primary/10">
              <AvatarImage src={metadata?.picture} alt={displayName} />
              <AvatarFallback className="text-sm font-semibold">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <Link
                to={`/${nip19.npubEncode(event.pubkey)}`}
                className="block truncate font-semibold text-foreground hover:text-primary transition-colors"
              >
                {displayName}
              </Link>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="truncate">@{genUserName(event.pubkey)}</span>
                <span>·</span>
                <time title={date.toLocaleString()}>{timeAgo}</time>
              </div>
            </div>
          </div>

          {/* Actions Menu */}
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
            ⋮
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-4">
        <p className="text-base leading-relaxed text-foreground whitespace-pre-wrap break-words">
          {event.content}
        </p>
      </div>

      {/* Interaction Stats */}
      <div className="px-6 py-3 border-t border-b border-border/30 bg-background/40 text-sm text-muted-foreground">
        {isLoadingEngagement ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs">Loading metrics...</span>
          </div>
        ) : (
          <div className="flex gap-6">
            <span>💬 <span className="font-semibold text-foreground">{engagement.replies}</span> {engagement.replies === 1 ? 'reply' : 'replies'}</span>
            <span>🔄 <span className="font-semibold text-foreground">{engagement.reposts}</span> {engagement.reposts === 1 ? 'repost' : 'reposts'}</span>
            <span>❤️ <span className="font-semibold text-foreground">{engagement.likes}</span> {engagement.likes === 1 ? 'like' : 'likes'}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="px-4 py-3 flex items-center justify-between">
        <ActionButton icon={MessageCircle} label="Reply" count={engagement.replies} />
        <ActionButton icon={Repeat2} label="Repost" count={engagement.reposts} />
        <ActionButton
          icon={Heart}
          label="Like"
          count={engagement.likes}
          isActive={isLiked}
          onClick={() => setIsLiked(!isLiked)}
        />
        <ActionButton icon={Share} label="Share" />
      </div>
    </Card>
  );
}

/**
 * Professional action button for post interactions
 */
function ActionButton({
  icon: Icon,
  label,
  count,
  isActive,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  isActive?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-2 text-muted-foreground',
        'hover:bg-primary/10 hover:text-primary transition-all duration-200',
        'text-xs font-medium',
        isActive && 'text-red-500 bg-red-50 dark:bg-red-950'
      )}
    >
      <Icon className="h-4 w-4" />
      {count !== undefined && <span>{count}</span>}
    </Button>
  );
}

/**
 * Format time difference for display
 */
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
