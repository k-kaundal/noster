import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { useReactions } from '@/hooks/useReactions';
import { useReposts } from '@/hooks/useReposts';
import { useReplies } from '@/hooks/useReplies';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NoteContent } from '@/components/NoteContent';
import { ReplyDialog } from '@/components/ReplyDialog';
import { RepliesSection } from '@/components/RepliesSection';
import { FollowButton } from '@/components/FollowButton';
import { Heart, MessageCircle, Repeat2, Share, MoreHorizontal, Loader2, ArrowUpRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { nip19 } from 'nostr-tools';

interface PostProps {
  event: NostrEvent;
  showReplies?: boolean;
}

export function Post({ event, showReplies = true }: PostProps) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);

  const { isLiked, likeCount, like, isLiking } = useReactions(event.id);
  const { isReposted, repostCount, repost, isReposting } = useReposts(event.id);
  const { replyCount } = useReplies(event.id);

  const displayName = metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const username = metadata?.name || genUserName(event.pubkey);
  const profileImage = metadata?.picture;
  const npub = nip19.npubEncode(event.pubkey);
  const noteId = nip19.noteEncode(event.id);

  const isRepost = event.kind === 6 || event.kind === 16;
  const eTags = event.tags.filter(tag => tag[0] === 'e');
  const isReply = eTags.length > 0;

  const imageUrls = event.content.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi) || [];

  const timeAgo = (() => {
    try {
      const timestamp = event.created_at * 1000;
      if (!timestamp || timestamp <= 0 || timestamp > Date.now() + 86400000) {
        return 'unknown time';
      }
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch {
      return 'unknown time';
    }
  })();

  const handleReply = () => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'You must be logged in to reply',
        variant: 'destructive',
      });
      return;
    }
    setReplyDialogOpen(true);
  };

  const handleRepost = async () => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'You must be logged in to repost',
        variant: 'destructive',
      });
      return;
    }
    try {
      await repost({ targetEvent: event });
      toast({
        title: 'Success',
        description: 'Post reposted successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to repost: ${error.message || 'Unknown error'}`,
        variant: 'destructive',
      });
    }
  };

  const handleLike = async () => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'You must be logged in to like',
        variant: 'destructive',
      });
      return;
    }
    try {
      await like({ targetEvent: event });
      toast({
        title: 'Success',
        description: isLiked ? 'Like removed' : 'Post liked',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to like: ${error.message || 'Unknown error'}`,
        variant: 'destructive',
      });
    }
  };

  const handleShare = async () => {
    const noteId = nip19.noteEncode(event.id);
    const url = `${window.location.origin}/${noteId}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Nostr Post',
          text: event.content.slice(0, 100) + (event.content.length > 100 ? '...' : ''),
          url,
        });
        toast({
          title: 'Success',
          description: 'Post shared successfully',
        });
      } catch (error) {
        // Ignore if user cancelled
        if (error.name !== 'AbortError') {
          toast({
            title: 'Error',
            description: 'Failed to share post',
            variant: 'destructive',
          });
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast({
          title: 'Link copied',
          description: 'Post link copied to clipboard',
        });
      } catch (error) {
        console.error('Post: Clipboard error:', error);
        toast({
          title: 'Error',
          description: 'Failed to copy link to clipboard',
          variant: 'destructive',
        });
      }
    }
  };

  return (
    <Card className="mb-4 animate-slide-up hover-lift transition-all duration-200 group">
      {isRepost && (
        <div className="px-4 pt-3 pb-1">
          <div className="flex items-center text-sm text-muted-foreground">
            <Repeat2 className="h-4 w-4 mr-2" />
            <Link to={`/${npub}`} className="hover:underline">
              {displayName}
            </Link>
            <span className="ml-1">reposted</span>
          </div>
        </div>
      )}

      {isReply && showReplies && (
        <div className="px-4 pt-3 pb-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center text-sm text-muted-foreground">
              <MessageCircle className="h-4 w-4 mr-2" />
              <span>Reply</span>
            </div>
            <Link
              to={`/${noteId}`}
              className="text-xs text-blue-600 hover:underline flex items-center"
            >
              View thread
              <ArrowUpRight className="h-3 w-3 ml-1" />
            </Link>
          </div>
        </div>
      )}

      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <Link to={`/${npub}`}>
              <Avatar className="h-10 w-10">
                <AvatarImage src={profileImage} alt={displayName} />
                <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </Link>
            <div className="flex flex-col">
              <div className="flex items-center space-x-2">
                <Link to={`/${npub}`} className="font-semibold hover:underline">
                  {displayName}
                </Link>
                {metadata?.nip05 && (
                  <Badge variant="secondary" className="text-xs">
                    ✓
                  </Badge>
                )}
              </div>
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <span>@{username}</span>
                <span>·</span>
                <Link to={`/${noteId}`} className="hover:underline">
                  {timeAgo}
                </Link>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <FollowButton
              pubkey={event.pubkey}
              className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            />
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-2">
        <div className="space-y-3">
          <div className="whitespace-pre-wrap break-words">
            <NoteContent event={event} className="text-sm" />
          </div>
          {imageUrls.length > 0 && (
            <div className={`grid gap-2 ${imageUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {imageUrls.map((url, index) => (
                <div key={index} className="rounded-lg overflow-hidden border">
                  <img
                    src={url}
                    alt=""
                    className="w-full h-auto max-h-96 object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between pt-2 max-w-md">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-blue-600 transition-all duration-200 hover:scale-105"
              onClick={handleReply}
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              <span className="text-sm">
                {replyCount > 0 ? replyCount : 'Reply'}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`text-muted-foreground hover:text-green-600 transition-all duration-200 hover:scale-105 ${isReposted ? 'text-green-600 font-semibold' : ''}`}
              onClick={handleRepost}
              disabled={isReposting}
            >
              {isReposting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Repeat2 className={`h-4 w-4 mr-2 ${isReposted ? 'fill-green-600' : ''}`} />
              )}
              <span className="text-sm">
                {repostCount > 0 ? repostCount : 'Repost'}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`text-muted-foreground hover:text-red-600 transition-all duration-200 hover:scale-105 ${isLiked ? 'text-red-600 font-semibold' : ''}`}
              onClick={handleLike}
              disabled={isLiking}
            >
              {isLiking ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Heart className={`h-4 w-4 mr-2 ${isLiked ? 'fill-red-600' : ''}`} />
              )}
              <span className="text-sm">
                {likeCount > 0 ? likeCount : 'Like'}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-blue-600 transition-all duration-200 hover:scale-105"
              onClick={handleShare}
            >
              <Share className="h-4 w-4 mr-2" />
              <span className="text-sm">Share</span>
            </Button>
          </div>
        </div>
      </CardContent>
      {showReplies && (
        <RepliesSection eventId={event.id} className="px-6 pb-4" />
      )}
      <ReplyDialog
        open={replyDialogOpen}
        onOpenChange={setReplyDialogOpen}
        replyingTo={event}
      />
    </Card>
  );
}