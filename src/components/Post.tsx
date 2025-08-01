import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NoteContent } from '@/components/NoteContent';
import { Heart, MessageCircle, Repeat2, Share, MoreHorizontal } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { nip19 } from 'nostr-tools';

interface PostProps {
  event: NostrEvent;
}

export function Post({ event }: PostProps) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const [isLiked, setIsLiked] = useState(false);
  const [isReposted, setIsReposted] = useState(false);

  const displayName = metadata?.display_name || metadata?.name || genUserName(event.pubkey);
  const username = metadata?.name || genUserName(event.pubkey);
  const profileImage = metadata?.picture;
  const npub = nip19.npubEncode(event.pubkey);
  const noteId = nip19.noteEncode(event.id);

  // Handle reposts
  const isRepost = event.kind === 6 || event.kind === 16;

  // Extract image URLs from content
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

  return (
    <Card className="mb-4 animate-slide-up hover-lift transition-all duration-200">
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
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pb-2">
        <div className="space-y-3">
          {/* Post Content */}
          <div className="whitespace-pre-wrap break-words">
            <NoteContent event={event} className="text-sm" />
          </div>

          {/* Images */}
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

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2 max-w-md">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-blue-600 transition-all duration-200 hover:scale-105"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              <span className="text-sm">Reply</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={`text-muted-foreground hover:text-green-600 transition-all duration-200 hover:scale-105 ${
                isReposted ? 'text-green-600 animate-pulse' : ''
              }`}
              onClick={() => setIsReposted(!isReposted)}
            >
              <Repeat2 className={`h-4 w-4 mr-2 ${isReposted ? 'animate-spin' : ''}`} />
              <span className="text-sm">Repost</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={`text-muted-foreground hover:text-red-600 transition-all duration-200 hover:scale-105 ${
                isLiked ? 'text-red-600' : ''
              }`}
              onClick={() => setIsLiked(!isLiked)}
            >
              <Heart className={`h-4 w-4 mr-2 transition-all duration-200 ${isLiked ? 'fill-current animate-pulse' : ''}`} />
              <span className="text-sm">Like</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-blue-600 transition-all duration-200 hover:scale-105"
            >
              <Share className="h-4 w-4 mr-2" />
              <span className="text-sm">Share</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}