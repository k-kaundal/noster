/**
 * Professional thread view component for displaying post conversations
 * Provides clear visual hierarchy and easy navigation through replies
 */

import { useEffect, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { genUserName } from '@/lib/genUserName';
import { MessageCircle, Reply } from 'lucide-react';

interface ThreadComment {
  id: string;
  author: {
    pubkey: string;
    name: string;
    avatar?: string;
  };
  content: string;
  timestamp: Date;
  likes: number;
  replies: number;
  level: number; // Nesting level
}

interface ThreadViewProps {
  mainPost: NostrEvent;
  replies: ThreadComment[];
  onReply?: (commentId: string) => void;
  className?: string;
}

/**
 * Professional thread view with collapsible nested replies
 */
export function ThreadView({
  mainPost,
  replies,
  onReply,
  className,
}: ThreadViewProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {/* Main Post - Highlighted */}
      <Card className="overflow-hidden border-l-4 border-l-primary bg-card/50 backdrop-blur">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <Avatar className="h-14 w-14 border-2 border-primary">
              <AvatarFallback>OP</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-lg">Original Post</div>
              <p className="text-sm text-muted-foreground mb-3">
                {mainPost.content}
              </p>
              <Badge variant="outline" className="bg-primary/10">
                {replies.length} replies
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* Replies Thread */}
      <div className="space-y-0 border-l-2 border-dashed border-border/50 ml-4">
        {replies.map((reply, index) => (
          <ThreadComment
            key={reply.id}
            comment={reply}
            isLast={index === replies.length - 1}
            onReply={() => onReply?.(reply.id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Individual comment in thread with nesting support
 */
function ThreadComment({
  comment,
  isLast,
  onReply,
}: {
  comment: ThreadComment;
  isLast: boolean;
  onReply: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div
      className={cn(
        'relative py-4 px-4 ml-0 group transition-colors hover:bg-background/50',
        !isLast && 'border-b border-border/30'
      )}
    >
      {/* Connection Line */}
      <div
        className="absolute left-[-13px] top-0 w-6 h-8 border-l-2 border-b-2 border-border/50"
        aria-hidden="true"
      />

      {/* Comment Content */}
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10 mt-1">
          <AvatarFallback className="text-xs">
            {comment.author.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          {/* Author Info */}
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-sm">{comment.author.name}</span>
            <span className="text-xs text-muted-foreground">
              @{genUserName(comment.author.pubkey)}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatTime(comment.timestamp)}
            </span>
          </div>

          {/* Comment Text */}
          <p className="text-sm leading-relaxed my-2 text-foreground">
            {comment.content}
          </p>

          {/* Engagement Stats */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground my-2">
            <span>❤️ {comment.likes}</span>
            <span>💬 {comment.replies}</span>
          </div>

          {/* Reply Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onReply}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-xs h-7 gap-1"
          >
            <Reply className="h-3 w-3" />
            Reply
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
