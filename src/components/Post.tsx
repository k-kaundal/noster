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
import { Heart, MessageCircle, Repeat2, Share, MoreHorizontal, Loader2, ArrowUpRight, Zap } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { nip19 } from 'nostr-tools';
import { useZaps } from '@/hooks/useZaps';
import { useNWC } from '@/hooks/useNWCContext';
import type { WebLNProvider } from 'webln';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'; // Assuming you have a UI library like shadcn/ui
import { Input } from '@/components/ui/input'; // Assuming Input component

// Placeholder hook to fetch original event
const useOriginalEvent = (eventId: string) => {
  const [originalEvent, setOriginalEvent] = useState<NostrEvent | null>(null);
  return { data: originalEvent, isLoading: false };
};

interface PostProps {
  event: NostrEvent;
  showReplies?: boolean;
  webln?: WebLNProvider;
}

export function Post({ event, showReplies = true, webln }: PostProps) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [zapDialogOpen, setZapDialogOpen] = useState(false); // State for zap dialog
  const [zapAmount, setZapAmount] = useState<number>(10); // Default zap amount
  const [zapComment, setZapComment] = useState<string>('Great post!'); // Default comment

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
  const originalEventId = eTags[0]?.[1];

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

  const { data: fetchedOriginalEvent } = useOriginalEvent(originalEventId || '');
  const parseEmbeddedEvent = (content: string): NostrEvent | null => {
    try {
      const jsonMatch = content.match(/\{.*\}/s);
      if (jsonMatch) return JSON.parse(jsonMatch[0]) as NostrEvent;
      return null;
    } catch (error) {
      console.error('Failed to parse embedded event:', error);
      return null;
    }
  };

  const embeddedOriginalEvent = isRepost ? parseEmbeddedEvent(event.content) : null;
  const originalEvent = fetchedOriginalEvent || embeddedOriginalEvent;

  const renderContent = () => {
    if (isRepost && originalEvent) {
      return (
        <div className="space-y-3">
          <div className="pl-4 border-l-2 border-gray-300 bg-gray-50 p-3 rounded-md">
            <Post event={originalEvent} showReplies={false} webln={webln} />
            <div className="text-sm text-muted-foreground mt-2">
              Reposted by {displayName}
            </div>
          </div>
          {imageUrls.length > 0 && (
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
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
        </div>
      );
    }
    return (
      <div className="whitespace-pre-wrap break-words">
        <NoteContent event={event} />
        {imageUrls.length > 0 && (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
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
      </div>
    );
  };

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

  // Use the useZaps hook
  const { zap, isZapping, zapCount, totalSats } = useZaps(
    event,
    webln ?? null,
    useNWC().getActiveConnection(),
    () => {
      toast({ title: 'Zap Success', description: 'Zap sent successfully!' });
      setZapDialogOpen(false);
    }
  );

  const handleZap = async () => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'You must be logged in to zap',
        variant: 'destructive',
      });
      return;
    }
    try {
      await zap(zapAmount, zapComment);
    } catch (error) {
      toast({
        title: 'Zap Failed',
        description: error.message || 'Failed to send zap',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="mb-4 animate-slide-up hover-lift transition-all duration-200 group w-full">
      {isRepost && originalEventId && (
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

      <CardHeader className="pb-2 p-4 sm:p-6">
        <div className="flex flex-row items-start justify-between">
          <div className="flex items-center space-x-3">
            <Link to={`/${npub}`}>
              <Avatar className="h-10 w-10 sm:h-12 sm:w-12">
                <AvatarImage src={profileImage} alt={displayName} />
                <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </Link>
            <div className="flex flex-col">
              <div className="flex items-center space-x-2">
                <Link to={`/${npub}`} className="font-semibold hover:underline text-sm sm:text-base">
                  {displayName}
                </Link>
                {metadata?.nip05 && (
                  <Badge variant="secondary" className="text-xs">
                    ✓
                  </Badge>
                )}
              </div>
              <div className="flex items-center space-x-2 text-xs sm:text-sm text-muted-foreground">
                <span>@{username}</span>
                <span>·</span>
                <Link to={`/${noteId}`} className="hover:underline">
                  {timeAgo}
                </Link>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2 mt-2 sm:mt-0">
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

      <CardContent className="pb-2 p-4 sm:p-6">
        <div className="space-y-3">
          {renderContent()}
          <div className="flex flex-row items-center justify-between pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-blue-600 transition-all duration-200 hover:scale-105 w-full sm:w-auto text-xs sm:text-sm"
              onClick={handleReply}
            >
              <MessageCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span>
                {replyCount > 0 ? replyCount : 'Reply'}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`text-muted-foreground hover:text-green-600 transition-all duration-200 hover:scale-105 w-full sm:w-auto text-xs sm:text-sm ${isReposted ? 'text-green-600 font-semibold' : ''}`}
              onClick={handleRepost}
              disabled={isReposting}
            >
              {isReposting ? (
                <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 animate-spin" />
              ) : (
                <Repeat2 className={`h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 ${isReposted ? 'fill-green-600' : ''}`} />
              )}
              <span>
                {repostCount > 0 ? repostCount : 'Repost'}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`text-muted-foreground hover:text-red-600 transition-all duration-200 hover:scale-105 w-full sm:w-auto text-xs sm:text-sm ${isLiked ? 'text-red-600 font-semibold' : ''}`}
              onClick={handleLike}
              disabled={isLiking}
            >
              {isLiking ? (
                <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 animate-spin" />
              ) : (
                <Heart className={`h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 ${isLiked ? 'fill-red-600' : ''}`} />
              )}
              <span>
                {likeCount > 0 ? likeCount : 'Like'}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`text-muted-foreground hover:text-yellow-600 transition-all duration-200 hover:scale-105 w-full sm:w-auto text-xs sm:text-sm ${isZapping ? 'text-yellow-600 font-semibold' : ''}`}
              onClick={() => setZapDialogOpen(true)}
              disabled={isZapping}
            >
              {isZapping ? (
                <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 animate-spin" />
              ) : (
                <Zap className={`h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 ${isZapping ? 'fill-yellow-600' : ''}`} />
              )}
              <span>
                {zapCount > 0 ? `${zapCount} (${totalSats}sats)` : 'Zap'}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-blue-600 transition-all duration-200 hover:scale-105 w-full sm:w-auto text-xs sm:text-sm"
              onClick={handleShare}
            >
              <Share className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span>Share</span>
            </Button>
          </div>
        </div>
      </CardContent>
      {showReplies && <RepliesSection eventId={event.id} className="px-4 sm:px-6 pb-4" />}
      <ReplyDialog open={replyDialogOpen} onOpenChange={setReplyDialogOpen} replyingTo={event} />
      <Dialog open={zapDialogOpen} onOpenChange={setZapDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send a Zap</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Amount (sats)</label>
              <Input
                type="number"
                value={zapAmount}
                onChange={(e) => setZapAmount(Math.max(1, parseInt(e.target.value) || 10))} // Minimum 1 sat
                className="mt-1 w-full"
                min="1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Comment</label>
              <Input
                type="text"
                value={zapComment}
                onChange={(e) => setZapComment(e.target.value)}
                className="mt-1 w-full"
                placeholder="Optional comment"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZapDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleZap}
              disabled={isZapping}
              className={`ml-2 ${isZapping ? 'bg-yellow-600 text-white' : 'bg-yellow-500 hover:bg-yellow-600 text-white'}`}
            >
              {isZapping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
              {isZapping ? 'Zapping...' : 'Send Zap'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}