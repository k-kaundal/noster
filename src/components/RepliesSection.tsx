import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';
import { useReplies } from '@/hooks/useReplies';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEvent } from '@/hooks/useEvent';
import { genUserName } from '@/lib/genUserName';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { NoteContent } from '@/components/NoteContent';
import { QuickReply } from '@/components/QuickReply';
import { ChevronDown, ChevronUp, MessageCircle, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { nip19 } from 'nostr-tools';

interface RepliesSectionProps {
  eventId: string;
  className?: string;
}

interface ReplyItemProps {
  reply: NostrEvent;
  level?: number;
}

function ReplyItem({ reply, level = 0 }: ReplyItemProps) {
  const author = useAuthor(reply.pubkey);
  const metadata = author.data?.metadata;
  const [showReplies, setShowReplies] = useState(false);

  // Get replies to this reply (nested replies)
  const { replies: nestedReplies, replyCount: nestedReplyCount } = useReplies(reply.id);

  const displayName = metadata?.display_name || metadata?.name || genUserName(reply.pubkey);
  const username = metadata?.name || genUserName(reply.pubkey);
  const profileImage = metadata?.picture;
  const npub = nip19.npubEncode(reply.pubkey);
  const noteId = nip19.noteEncode(reply.id);

  const timeAgo = (() => {
    try {
      const timestamp = reply.created_at * 1000;
      if (!timestamp || timestamp <= 0 || timestamp > Date.now() + 86400000) {
        return 'unknown time';
      }
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch {
      return 'unknown time';
    }
  })();

  // Limit nesting depth to prevent infinite recursion
  const maxDepth = 3;
  const isMaxDepth = level >= maxDepth;

  return (
    <div className={`${level > 0 ? 'ml-8 border-l-2 border-muted pl-4' : ''}`}>
      <Card className="mb-3 bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <Link to={`/${npub}`}>
                <Avatar className="h-8 w-8">
                  <AvatarImage src={profileImage} alt={displayName} />
                  <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              </Link>
              <div className="flex flex-col">
                <div className="flex items-center space-x-2">
                  <Link to={`/${npub}`} className="font-semibold text-sm hover:underline">
                    {displayName}
                  </Link>
                  {metadata?.nip05 && (
                    <Badge variant="secondary" className="text-xs">
                      ✓
                    </Badge>
                  )}
                </div>
                <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                  <span>@{username}</span>
                  <span>·</span>
                  <Link to={`/${noteId}`} className="hover:underline">
                    {timeAgo}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <div className="space-y-3">
            {/* Reply Content */}
            <div className="text-sm">
              <NoteContent event={reply} />
            </div>

            {/* Show nested replies button */}
            {nestedReplyCount > 0 && !isMaxDepth && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowReplies(!showReplies)}
                className="text-xs text-muted-foreground hover:text-blue-600 p-0 h-auto"
              >
                {showReplies ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" />
                    Hide {nestedReplyCount} {nestedReplyCount === 1 ? 'reply' : 'replies'}
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Show {nestedReplyCount} {nestedReplyCount === 1 ? 'reply' : 'replies'}
                  </>
                )}
              </Button>
            )}

            {isMaxDepth && nestedReplyCount > 0 && (
              <Link
                to={`/${noteId}`}
                className="text-xs text-blue-600 hover:underline flex items-center"
              >
                <MessageCircle className="h-3 w-3 mr-1" />
                View {nestedReplyCount} more {nestedReplyCount === 1 ? 'reply' : 'replies'}
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Nested Replies */}
      {showReplies && nestedReplies.length > 0 && !isMaxDepth && (
        <div className="space-y-2">
          {nestedReplies
            .sort((a, b) => a.created_at - b.created_at) // Sort by oldest first
            .slice(0, 5) // Limit to 5 nested replies to prevent UI overflow
            .map((nestedReply) => (
              <ReplyItem
                key={nestedReply.id}
                reply={nestedReply}
                level={level + 1}
              />
            ))}
          {nestedReplies.length > 5 && (
            <Link
              to={`/${noteId}`}
              className="text-xs text-blue-600 hover:underline ml-8 block"
            >
              View {nestedReplies.length - 5} more replies...
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function RepliesSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="bg-muted/30">
          <CardHeader className="pb-2">
            <div className="flex items-center space-x-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function RepliesSection({ eventId, className }: RepliesSectionProps) {
  const { replies, replyCount, isLoading } = useReplies(eventId);
  const [showReplies, setShowReplies] = useState(false);
  const [showQuickReply, setShowQuickReply] = useState(false);
  const { user } = useCurrentUser();
  const { data: originalEvent } = useEvent(eventId);

  if (replyCount === 0) {
    return null;
  }

  const handleReplyPosted = () => {
    // Refresh replies by invalidating the query
    // The useReplies hook will automatically refetch
    setShowQuickReply(false);
  };

  return (
    <div className={className}>
      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-4">
          <Button
            variant="ghost"
            onClick={() => setShowReplies(!showReplies)}
            className="text-sm text-muted-foreground hover:text-blue-600 p-0 h-auto"
          >
            {showReplies ? (
              <>
                <ChevronUp className="h-4 w-4 mr-2" />
                Hide {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-2" />
                Show {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </>
            )}
          </Button>

          {user && originalEvent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowQuickReply(!showQuickReply)}
              className="text-xs text-muted-foreground hover:text-blue-600"
            >
              <Plus className="h-3 w-3 mr-1" />
              Quick reply
            </Button>
          )}
        </div>

        {/* Quick Reply Form */}
        {showQuickReply && originalEvent && (
          <div className="mb-4">
            <QuickReply
              replyingTo={originalEvent}
              onReplyPosted={handleReplyPosted}
              className="bg-muted/30 rounded-lg p-4"
            />
            <Separator className="mt-4" />
          </div>
        )}

        {showReplies && (
          <div className="space-y-3">
            {isLoading ? (
              <RepliesSkeleton />
            ) : (
              <>
                {replies
                  .sort((a, b) => a.created_at - b.created_at) // Sort by oldest first
                  .map((reply) => (
                    <ReplyItem key={reply.id} reply={reply} />
                  ))}

                {replies.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No replies found</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}