import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import {
  Heart,
  MessageCircle,
  Repeat2,
  Share,
  MoreHorizontal,
} from 'lucide-react';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { NoteContent } from '@/components/NoteContent';
import { cn } from '@/lib/utils';

/**
 * X/Twitter-inspired post component with modern, clean design
 * Features: Better spacing, hover states, cleaner typography
 */
export function PostX({ event }: { event: NostrEvent }) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const { user } = useCurrentUser();

  const [isLiked, setIsLiked] = useState(false);
  const [isReposted, setIsReposted] = useState(false);

  const npub = nip19.npubEncode(event.pubkey);
  const noteId = nip19.noteEncode(event.id);

  const handleLike = () => {
    setIsLiked(!isLiked);
  };

  const handleRepost = () => {
    setIsReposted(!isReposted);
  };

  return (
    <div className="group border-b border-border/50 bg-background transition-colors hover:bg-background/50">
      <div className="px-4 py-3 sm:px-5 sm:py-4">
        {/* Header: Avatar, Name, Handle, Time */}
        <div className="flex gap-3">
          <Link to={`/${npub}`} className="shrink-0">
            <Avatar className="h-12 w-12 transition-opacity hover:opacity-80">
              <AvatarImage src={metadata?.picture} alt={displayName} />
              <AvatarFallback className="bg-primary/10 text-xs font-semibold">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Link>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  to={`/${npub}`}
                  className="font-bold text-foreground hover:underline truncate"
                >
                  {displayName}
                </Link>
                <span className="text-muted-foreground truncate">
                  @{genUserName(event.pubkey)}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground text-sm">
                  {formatTime(event.created_at)}
                </span>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="ml-[60px] mt-2">
          <div className="text-base leading-normal text-foreground break-words">
            <NoteContent event={event} />
          </div>
        </div>

        {/* Engagement Stats */}
        <div className="ml-[60px] mt-3 flex gap-4 text-xs text-muted-foreground border-t border-border/30 pt-3 pb-2">
          <button className="hover:text-reply transition-colors group/stat">
            <span className="group-hover/stat:bg-reply/10 group-hover/stat:text-reply px-2 py-1 rounded transition-colors">
              💬 1.2K
            </span>
          </button>
          <button className="hover:text-repost transition-colors group/stat">
            <span className="group-hover/stat:bg-repost/10 group-hover/stat:text-repost px-2 py-1 rounded transition-colors">
              🔄 456
            </span>
          </button>
          <button className="hover:text-like transition-colors group/stat">
            <span className="group-hover/stat:bg-like/10 group-hover/stat:text-like px-2 py-1 rounded transition-colors">
              ❤️ 8.9K
            </span>
          </button>
          <button className="hover:text-foreground transition-colors group/stat">
            <span className="group-hover/stat:bg-foreground/5 px-2 py-1 rounded transition-colors">
              📊 234K
            </span>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="ml-[60px] mt-3 flex justify-around text-muted-foreground">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 h-9 gap-2 text-muted-foreground hover:text-reply hover:bg-reply/10"
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRepost}
            className={cn(
              'flex-1 h-9 gap-2 text-muted-foreground hover:text-repost hover:bg-repost/10',
              isReposted && 'text-repost bg-repost/10'
            )}
          >
            <Repeat2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLike}
            className={cn(
              'flex-1 h-9 gap-2 text-muted-foreground hover:text-like hover:bg-like/10',
              isLiked && 'text-like bg-like/10'
            )}
          >
            <Heart className={cn('h-4 w-4', isLiked && 'fill-current')} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 h-9 gap-2 text-muted-foreground hover:text-foreground hover:bg-foreground/5"
          >
            <Share className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp * 1000;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
