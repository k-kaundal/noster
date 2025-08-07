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
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'framer-motion';

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
  const [zapDialogOpen, setZapDialogOpen] = useState(false);
  const [zapAmount, setZapAmount] = useState<number>(10);
  const [zapComment, setZapComment] = useState<string>('Great post!');

  const { isLiked, likeCount, like, isLiking } = useReactions(event.id);
  const { isReposted, repostCount, repost, isReposting } = useReposts(event.id);
  const { replyCount } = useReplies(event.id);

  const displayName = metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const username = metadata?.name || genUserName(event.pubkey);
  const profileImage = metadata?.picture;
  const npub = nip19.npubEncode(event.pubkey);
  const noteId = nip19.noteEncode(event.id);

  const isRepost = event.kind === 6 || event.kind === 16;
  const eTags = event.tags.filter((tag) => tag[0] === 'e');
  const isReply = eTags.length > 0;
  const originalEventId = eTags[0]?.[1];
  const canZap = author.data?.metadata?.lud06 || author.data?.metadata?.lud16;

  const { zap, isZapping, zapCount, totalSats, invoice, resetInvoice } = useZaps(
    event,
    webln ?? null,
    useNWC().getActiveConnection(),
    () => {
      toast({ title: 'Zap Success', description: 'Zap sent successfully!' });
      setZapDialogOpen(false);
    }
  );

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

  // Animation variants
  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
    hover: { scale: 1.01, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.1)', transition: { duration: 0.3 } },
  };

  const buttonVariants = {
    hover: { scale: 1.1, transition: { duration: 0.2 } },
    tap: { scale: 0.95, transition: { duration: 0.2 } },
  };

  const renderContent = () => {
    if (isRepost && originalEvent) {
      return (
        <div className="space-y-4">
          <div className="pl-4 border-l-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            <Post event={originalEvent} showReplies={false} webln={webln} />
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Reposted by {displayName}
            </div>
          </div>
          {imageUrls.length > 0 && (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {imageUrls.map((url, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700"
                >
                  <img
                    src={url}
                    alt=""
                    className="w-full h-auto max-h-80 object-cover"
                    loading="lazy"
                  />
                </motion.div>
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
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {imageUrls.map((url, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
                className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700"
              >
                <img
                  src={url}
                  alt=""
                  className="w-full h-auto max-h-80 object-cover"
                  loading="lazy"
                />
              </motion.div>
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

  const handleZap = async () => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'You must be logged in to zap',
        variant: 'destructive',
      });
      return;
    }
    if (!canZap) {
      toast({
        title: 'Error',
        description: 'Author does not have a Lightning address configured',
        variant: 'destructive',
      });
      return;
    }
    try {
      await zap(zapAmount, zapComment);
    } catch (error) {
      console.error('handleZap error:', error);
      toast({
        title: 'Zap Failed',
        description: (error as Error).message || 'Failed to send zap',
        variant: 'destructive',
      });
    }
  };

  return (
    <motion.div
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover="hover"
      className="mb-6 max-w-3xl mx-auto w-full"
    >
      <Card className="border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-lg transition-shadow duration-300 rounded-xl">
        {isRepost && originalEventId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="px-4 sm:px-6 pt-3 pb-1"
          >
            <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
              <Repeat2 className="h-4 w-4 mr-2" />
              <Link to={`/${npub}`} className="hover:underline font-medium">
                {displayName}
              </Link>
              <span className="ml-1">reposted</span>
            </div>
          </motion.div>
        )}

        {isReply && showReplies && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="px-4 sm:px-6 pt-3 pb-1"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
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
          </motion.div>
        )}

        <CardHeader className="p-4 sm:p-6">
          <div className="flex flex-row items-start justify-between">
            <div className="flex items-center space-x-3">
              <Link to={`/${npub}`}>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Avatar className="h-10 w-10 sm:h-12 sm:w-12 ring-2 ring-gray-200 dark:ring-gray-700 ring-offset-2">
                    <AvatarImage src={profileImage} alt={displayName} />
                    <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </motion.div>
              </Link>
              <div className="flex flex-col">
                <div className="flex items-center space-x-2">
                  <Link to={`/${npub}`} className="font-semibold hover:underline text-base sm:text-lg">
                    {displayName}
                  </Link>
                  {metadata?.nip05 && (
                    <Badge variant="secondary" className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-100">
                      ✓ Verified
                    </Badge>
                  )}
                </div>
                <div className="flex items-center space-x-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
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
                className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700"
              />
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-gray-100 dark:hover:bg-gray-800">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6">
          <div className="space-y-4">
            {renderContent()}
            <div className="flex flex-row items-center justify-between pt-3 gap-2">
              <motion.div variants={buttonVariants} whileHover="hover" whileTap="tap">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-500 transition-all duration-200 w-full sm:w-auto text-xs sm:text-sm"
                  onClick={handleReply}
                  aria-label="Reply to post"
                >
                  <MessageCircle className="h-4 w-4 mr-2" />
                  <span>{replyCount > 0 ? replyCount : 'Reply'}</span>
                </Button>
              </motion.div>
              <motion.div variants={buttonVariants} whileHover="hover" whileTap="tap">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-500 transition-all duration-200 w-full sm:w-auto text-xs sm:text-sm ${isReposted ? 'text-green-600 dark:text-green-500 font-semibold' : ''}`}
                  onClick={handleRepost}
                  disabled={isReposting}
                  aria-label="Repost"
                >
                  {isReposting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Repeat2 className={`h-4 w-4 mr-2 ${isReposted ? 'fill-green-600 dark:fill-green-500' : ''}`} />
                  )}
                  <span>{repostCount > 0 ? repostCount : 'Repost'}</span>
                </Button>
              </motion.div>
              <motion.div variants={buttonVariants} whileHover="hover" whileTap="tap">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-500 transition-all duration-200 w-full sm:w-auto text-xs sm:text-sm ${isLiked ? 'text-red-600 dark:text-red-500 font-semibold' : ''}`}
                  onClick={handleLike}
                  disabled={isLiking}
                  aria-label="Like post"
                >
                  {isLiking ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Heart className={`h-4 w-4 mr-2 ${isLiked ? 'fill-red-600 dark:fill-red-500' : ''}`} />
                  )}
                  <span>{likeCount > 0 ? likeCount : 'Like'}</span>
                </Button>
              </motion.div>
              <motion.div variants={buttonVariants} whileHover="hover" whileTap="tap">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`text-gray-500 dark:text-gray-400 hover:text-yellow-600 dark:hover:text-yellow-500 transition-all duration-200 w-full sm:w-auto text-xs sm:text-sm ${isZapping ? 'text-yellow-600 dark:text-yellow-500 font-semibold' : ''}`}
                  onClick={() => setZapDialogOpen(true)}
                  disabled={isZapping || !canZap}
                  aria-label="Zap post"
                >
                  {isZapping ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className={`h-4 w-4 mr-2 ${isZapping ? 'fill-yellow-600 dark:fill-yellow-500' : ''}`} />
                  )}
                  <span>{zapCount > 0 ? `${zapCount} (${totalSats}sats)` : 'Zap'}</span>
                </Button>
              </motion.div>
            </div>
          </div>
        </CardContent>
        {showReplies && <RepliesSection eventId={event.id} className="px-4 sm:px-6 pb-4" />}
      </Card>

      <Dialog open={zapDialogOpen} onOpenChange={setZapDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Send a Zap</DialogTitle>
          </DialogHeader>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-4 py-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Amount (sats)</label>
              <Input
                type="number"
                value={zapAmount}
                onChange={(e) => setZapAmount(Math.max(1, parseInt(e.target.value) || 10))}
                className="mt-1 w-full rounded-md border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500"
                min="1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Comment</label>
              <Input
                type="text"
                value={zapComment}
                onChange={(e) => setZapComment(e.target.value)}
                className="mt-1 w-full rounded-md border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-purple-500"
                placeholder="Optional comment"
              />
            </div>
            {invoice && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="mt-4"
              >
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Scan this QR code or copy the invoice to pay with a Lightning wallet:
                </p>
                <QRCodeSVG value={invoice} className="mt-2 mx-auto" size={200} />
                <p className="text-xs text-gray-500 dark:text-gray-400 break-all mt-2">{invoice}</p>
                <div className="mt-3 flex space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(invoice);
                      toast({ title: 'Invoice copied', description: 'The invoice has been copied to your clipboard.' });
                    }}
                    className="flex-1"
                  >
                    Copy Invoice
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      resetInvoice();
                      toast({ title: 'Invoice cleared', description: 'You can try zapping again.' });
                    }}
                    className="flex-1"
                  >
                    Clear Invoice
                  </Button>
                </div>
              </motion.div>
            )}
          </motion.div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZapDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleZap}
              disabled={isZapping || !canZap || !!invoice}
              className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white"
            >
              {isZapping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
              {isZapping ? 'Zapping...' : 'Send Zap'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReplyDialog open={replyDialogOpen} onOpenChange={setReplyDialogOpen} replyingTo={event} />
    </motion.div>
  );
}