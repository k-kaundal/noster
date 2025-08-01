import { useTrending } from '@/hooks/useTrending';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Post } from '@/components/Post';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { RelaySelector } from '@/components/RelaySelector';
import { TrendingUp, Hash, AtSign } from 'lucide-react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

export function Trending() {
  const { data: trendingData, isLoading, error } = useTrending();

  if (error) {
    return (
      <div className="col-span-full">
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-6">
              <p className="text-muted-foreground">
                Failed to load trending content. Try another relay?
              </p>
              <RelaySelector className="w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-2">
          <TrendingUp className="h-6 w-6" />
          <h1 className="text-3xl font-bold">Trending</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trending Hashtags Skeleton */}
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-8" />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Popular Posts Skeleton */}
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-6 w-32" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="flex items-start space-x-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center space-x-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-4/5" />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const { popularPosts = [], topHashtags = [], topMentions = [] } = trendingData || {};

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center space-x-2">
        <TrendingUp className="h-6 w-6 text-orange-500 animate-pulse" />
        <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
          Trending
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar with trending data */}
        <div className="space-y-6">
          {/* Trending Hashtags */}
          <Card className="hover-lift transition-all duration-200 animate-slide-up">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Hash className="h-5 w-5 text-blue-500" />
                <span>Trending Hashtags</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topHashtags.length === 0 ? (
                <p className="text-muted-foreground text-sm">No trending hashtags found</p>
              ) : (
                <div className="space-y-3">
                  {topHashtags.map(({ tag, count }, index) => (
                    <div key={tag} className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="font-medium text-blue-600 hover:underline cursor-pointer">
                          {tag}
                        </span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {count}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Mentioned Users */}
          <Card className="hover-lift transition-all duration-200 animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <AtSign className="h-5 w-5 text-green-500" />
                <span>Most Mentioned</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topMentions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No mentions found</p>
              ) : (
                <div className="space-y-3">
                  {topMentions.slice(0, 5).map(({ pubkey, count }, index) => (
                    <MentionedUser key={pubkey} pubkey={pubkey} count={count} rank={index + 1} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Popular Posts */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-semibold">Popular Posts</h2>

          {popularPosts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 px-8 text-center">
                <div className="max-w-sm mx-auto space-y-4">
                  <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground" />
                  <p className="text-muted-foreground">
                    No trending posts found. Try switching relays?
                  </p>
                  <RelaySelector className="w-full" />
                </div>
              </CardContent>
            </Card>
          ) : (
            popularPosts.map((post) => (
              <Post key={post.id} event={post} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function MentionedUser({ pubkey, count, rank }: { pubkey: string; count: number; rank: number }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name || genUserName(pubkey);
  const profileImage = metadata?.picture;
  const npub = nip19.npubEncode(pubkey);

  return (
    <div className="flex items-center justify-between">
      <Link to={`/${npub}`} className="flex items-center space-x-2 hover:opacity-80">
        <span className="text-sm font-medium text-muted-foreground w-4">
          {rank}
        </span>
        <Avatar className="h-6 w-6">
          <AvatarImage src={profileImage} alt={displayName} />
          <AvatarFallback className="text-xs">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium text-sm truncate max-w-[120px]">
          {displayName}
        </span>
      </Link>
      <Badge variant="secondary" className="text-xs">
        {count}
      </Badge>
    </div>
  );
}