import { useExplore } from '@/hooks/useExplore';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Post } from '@/components/Post';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RelaySelector } from '@/components/RelaySelector';
import { Compass, Users, Image, Link as LinkIcon, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

export function Explore() {
  const { data: exploreData, isLoading, error } = useExplore();

  if (error) {
    return (
      <div className="col-span-full">
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-6">
              <p className="text-muted-foreground">
                Failed to load explore content. Try another relay?
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
          <Compass className="h-6 w-6" />
          <h1 className="text-3xl font-bold">Explore</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sidebar Skeleton */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center space-x-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Main Content Skeleton */}
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

  const {
    recentPosts = [],
    postsWithImages = [],
    postsWithLinks = [],
    uniqueAuthors = []
  } = exploreData || {};

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center space-x-2">
        <Compass className="h-6 w-6 text-purple-500 animate-pulse" />
        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
          Explore
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar */}
        <div className="space-y-6">
          {/* Suggested Users */}
          <Card className="hover-lift transition-all duration-200 animate-slide-up">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Users className="h-5 w-5 text-blue-500" />
                <span>Discover People</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {uniqueAuthors.length === 0 ? (
                <p className="text-muted-foreground text-sm">No users found</p>
              ) : (
                <div className="space-y-3">
                  {uniqueAuthors.slice(0, 5).map((pubkey) => (
                    <SuggestedUser key={pubkey} pubkey={pubkey} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card className="hover-lift transition-all duration-200 animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <CardHeader>
              <CardTitle>Content Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Image className="h-4 w-4" />
                  <span className="text-sm">Posts with Images</span>
                </div>
                <span className="text-sm font-medium">{postsWithImages.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <LinkIcon className="h-4 w-4" />
                  <span className="text-sm">Posts with Links</span>
                </div>
                <span className="text-sm font-medium">{postsWithLinks.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileText className="h-4 w-4" />
                  <span className="text-sm">Recent Posts</span>
                </div>
                <span className="text-sm font-medium">{recentPosts.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Posts with Images */}
          {postsWithImages.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold flex items-center space-x-2">
                <Image className="h-5 w-5" />
                <span>Posts with Images</span>
              </h2>
              {postsWithImages.slice(0, 3).map((post) => (
                <Post key={post.id} event={post} />
              ))}
            </div>
          )}

          {/* Recent Diverse Posts */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Discover Posts</h2>

            {recentPosts.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 px-8 text-center">
                  <div className="max-w-sm mx-auto space-y-4">
                    <Compass className="h-12 w-12 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">
                      No posts found. Try switching relays?
                    </p>
                    <RelaySelector className="w-full" />
                  </div>
                </CardContent>
              </Card>
            ) : (
              recentPosts.map((post) => (
                <Post key={post.id} event={post} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestedUser({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name || genUserName(pubkey);
  const profileImage = metadata?.picture;
  const bio = metadata?.about;
  const npub = nip19.npubEncode(pubkey);

  return (
    <div className="flex items-start justify-between">
      <Link to={`/${npub}`} className="flex items-start space-x-3 hover:opacity-80 flex-1 min-w-0">
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarImage src={profileImage} alt={displayName} />
          <AvatarFallback className="text-xs">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{displayName}</p>
          {bio && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {bio.slice(0, 60)}{bio.length > 60 ? '...' : ''}
            </p>
          )}
        </div>
      </Link>
      <Button variant="outline" size="sm" className="ml-2 flex-shrink-0">
        Follow
      </Button>
    </div>
  );
}