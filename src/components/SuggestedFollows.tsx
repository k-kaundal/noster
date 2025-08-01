import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FollowButton } from '@/components/FollowButton';
import { Users, X } from 'lucide-react';
import { nip19 } from 'nostr-tools';



function SuggestedUserItem({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;

  const displayName = metadata?.display_name || metadata?.name || genUserName(pubkey);
  const username = metadata?.name || genUserName(pubkey);
  const profileImage = metadata?.picture;
  const bio = metadata?.about;
  const npub = nip19.npubEncode(pubkey);

  return (
    <div className="flex items-start space-x-3 p-3 border-b last:border-b-0">
      <Link to={`/${npub}`}>
        <Avatar className="h-10 w-10">
          <AvatarImage src={profileImage} alt={displayName} />
          <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </Link>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <Link to={`/${npub}`} className="font-semibold text-sm hover:underline truncate">
                {displayName}
              </Link>
              {metadata?.nip05 && (
                <Badge variant="secondary" className="text-xs">
                  ✓
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">@{username}</p>
            {bio && (
              <p className="text-xs mt-1 line-clamp-2 text-muted-foreground">{bio}</p>
            )}
          </div>

          <FollowButton pubkey={pubkey} size="sm" />
        </div>
      </div>
    </div>
  );
}

function SuggestedUserSkeleton() {
  return (
    <div className="flex items-start space-x-3 p-3 border-b">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <div className="space-y-1 flex-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-6 w-16" />
        </div>
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  );
}

export function SuggestedFollows() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const [isVisible, setIsVisible] = useState(true);

  // Get current user's following list
  const { followingList } = useFollows(user?.pubkey || '');
  const currentFollowing = followingList.map(f => f.pubkey);

  // Query for suggested users based on who your follows are following
  const suggestedQuery = useQuery({
    queryKey: ['suggested-follows', user?.pubkey],
    queryFn: async (c) => {
      if (!user || currentFollowing.length === 0) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);

      // Get follow lists of people you follow
      const followOfFollowsEvents = await nostr.query([{
        kinds: [3],
        authors: currentFollowing.slice(0, 10), // Limit to first 10 to avoid too many queries
        limit: 50,
      }], { signal });

      // Count how many of your follows follow each person
      const suggestions: Record<string, number> = {};

      followOfFollowsEvents.forEach(event => {
        const pTags = event.tags.filter(tag => tag[0] === 'p');
        pTags.forEach(tag => {
          const pubkey = tag[1];
          // Don't suggest yourself or people you already follow
          if (pubkey !== user.pubkey && !currentFollowing.includes(pubkey)) {
            suggestions[pubkey] = (suggestions[pubkey] || 0) + 1;
          }
        });
      });

      // Sort by score and return top suggestions
      const sorted = Object.entries(suggestions)
        .map(([pubkey, score]) => ({ pubkey, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      return sorted;
    },
    enabled: !!user && currentFollowing.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Don't show if user is not logged in or has dismissed
  if (!user || !isVisible) {
    return null;
  }

  // Don't show if user is following less than 3 people (not enough data for suggestions)
  if (currentFollowing.length < 3) {
    return null;
  }

  const suggestions = suggestedQuery.data || [];

  // Don't show if no suggestions
  if (!suggestedQuery.isLoading && suggestions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center space-x-2">
            <Users className="h-5 w-5" />
            <span>Who to follow</span>
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsVisible(false)}
            className="h-6 w-6"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {suggestedQuery.isLoading ? (
          <div>
            {Array.from({ length: 3 }).map((_, i) => (
              <SuggestedUserSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div>
            {suggestions.map((suggestion) => (
              <SuggestedUserItem key={suggestion.pubkey} pubkey={suggestion.pubkey} />
            ))}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="p-3 border-t">
            <Button variant="ghost" size="sm" className="w-full text-blue-600">
              Show more
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}