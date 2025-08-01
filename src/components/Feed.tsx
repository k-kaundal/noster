import { useState, useEffect } from 'react';
import { useFeed } from '@/hooks/useFeed';
import { Post } from '@/components/Post';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RelaySelector } from '@/components/RelaySelector';

import { RefreshCw, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Feed() {
  const { data: posts, isLoading, error, refetch, isFetching } = useFeed();
  const [newPostsCount, setNewPostsCount] = useState(0);
  const [lastPostId, setLastPostId] = useState<string | null>(null);

  // Check for new posts
  useEffect(() => {
    if (posts && posts.length > 0) {
      const latestPostId = posts[0].id;
      if (lastPostId && latestPostId !== lastPostId) {
        const newPosts = posts.findIndex(post => post.id === lastPostId);
        if (newPosts > 0) {
          setNewPostsCount(newPosts);
        }
      }
      if (!lastPostId) {
        setLastPostId(latestPostId);
      }
    }
  }, [posts, lastPostId]);

  const handleRefresh = () => {
    refetch();
    setNewPostsCount(0);
    if (posts && posts.length > 0) {
      setLastPostId(posts[0].id);
    }
  };

  if (error) {
    return (
      <div className="col-span-full">
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-6">
              <p className="text-muted-foreground">
                Failed to load posts. Try another relay?
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
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
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
                    <Skeleton className="h-4 w-3/5" />
                  </div>
                  <div className="flex space-x-4 pt-2">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-8 w-16" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="col-span-full">
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-6">
              <p className="text-muted-foreground">
                No posts found. Try another relay?
              </p>
              <RelaySelector className="w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
          Latest Posts
        </h2>
        <div className="flex items-center space-x-2">
          {newPostsCount > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={handleRefresh}
              className="bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 animate-pulse"
            >
              <Zap className="h-4 w-4 mr-2" />
              {newPostsCount} new post{newPostsCount > 1 ? 's' : ''}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="hover-lift transition-all duration-200"
          >
            <RefreshCw className={`h-4 w-4 mr-2 transition-transform duration-500 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {posts.map((post, index) => (
          <div
            key={post.id}
            className="animate-slide-up"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <Post event={post} />
          </div>
        ))}
      </div>
    </div>
  );
}