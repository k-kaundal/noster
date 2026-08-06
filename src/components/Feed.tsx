import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Film, Loader2, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { useFeed, type FeedScope } from '@/hooks/useFeed';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Post } from '@/components/Post';
import { PostSkeletonList } from '@/components/PostSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingHashtags, TrendingPeople } from '@/components/TrendingCards';
import { useTrending } from '@/hooks/useTrending';
import { cn } from '@/lib/utils';

export function Feed() {
  const { user } = useCurrentUser();
  const [scope, setScope] = useState<FeedScope>('global');

  const {
    posts,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    enabled,
  } = useFeed(scope);

  const { data: trending, isLoading: isTrendingLoading } = useTrending();

  // Track the newest note the reader has actually seen, so the "new posts"
  // pill only counts notes that arrived after they arrived on the page.
  const [seenTopId, setSeenTopId] = useState<string | null>(null);
  const newCount = (() => {
    if (!posts?.length || !seenTopId) return 0;
    const index = posts.findIndex((post) => post.id === seenTopId);
    return index > 0 ? index : 0;
  })();

  useEffect(() => {
    if (posts?.length && !seenTopId) setSeenTopId(posts[0].id);
  }, [posts, seenTopId]);

  const showNewPosts = () => {
    if (posts?.length) setSeenTopId(posts[0].id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRefresh = async () => {
    await refetch();
    setSeenTopId(null);
  };

  // Auto-load the next page as the sentinel scrolls into view
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      },
      { rootMargin: '600px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Tabs
          value={scope}
          onValueChange={(value) => {
            setScope(value as FeedScope);
            setSeenTopId(null);
          }}
        >
          <TabsList>
            <TabsTrigger value="global">Global</TabsTrigger>
            <TabsTrigger value="following" disabled={!user}>
              Following
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefetching}
          aria-label="Refresh feed"
          className="text-muted-foreground"
        >
          <RefreshCw
            className={cn('h-4 w-4 sm:mr-2', isRefetching && 'animate-spin')}
          />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {newCount > 0 && (
        <div className="sticky top-[calc(var(--header-height)+0.5rem)] z-30 flex justify-center">
          <Button
            size="sm"
            onClick={showNewPosts}
            className="animate-slide-down rounded-full bg-brand-gradient shadow-lg"
          >
            <ArrowUp className="mr-1.5 h-3.5 w-3.5" />
            {newCount} new {newCount === 1 ? 'post' : 'posts'}
          </Button>
        </div>
      )}

      {/* Entry point to the vertical video feed */}
      <Link
        to="/reels"
        className="group flex items-center gap-3 rounded-xl border bg-card p-3 shadow-card transition-colors hover:border-primary/40 hover:bg-accent/40"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-primary-foreground">
          <Film className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Reels</span>
          <span className="block truncate text-xs text-muted-foreground">
            Short vertical videos from across Nostr
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium text-primary group-hover:underline">
          Watch
        </span>
      </Link>

      {/* Discovery widgets are inline below xl, where the right rail is hidden */}
      <div className="grid gap-4 sm:grid-cols-2 xl:hidden">
        <TrendingHashtags
          hashtags={trending?.topHashtags ?? []}
          isLoading={isTrendingLoading}
          limit={3}
        />
        <TrendingPeople
          mentions={trending?.topMentions ?? []}
          isLoading={isTrendingLoading}
          limit={3}
        />
      </div>

      {isLoading ? (
        <PostSkeletonList />
      ) : isError ? (
        <EmptyState
          icon={MessageSquare}
          title="Couldn't load the feed"
          description="The relay didn't respond in time."
          showRelaySelector
          action={
            <Button variant="outline" onClick={handleRefresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          }
        />
      ) : scope === 'following' && !enabled ? (
        <EmptyState
          icon={Users}
          title="Your following feed is empty"
          description="Follow a few people and their notes will show up here."
          action={
            <Button asChild>
              <Link to="/explore">Find people to follow</Link>
            </Button>
          }
        />
      ) : !posts?.length ? (
        <EmptyState
          icon={MessageSquare}
          title="No posts yet"
          description="This relay has nothing to show right now."
          showRelaySelector
          action={
            user ? (
              <Button asChild className="bg-brand-gradient">
                <Link to="/compose">Write the first note</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="space-y-4">
            {posts.map((post) => (
              <Post key={post.id} event={post} />
            ))}
          </div>

          <div ref={sentinelRef} className="py-4 text-center">
            {isFetchingNextPage ? (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading more notes…
              </span>
            ) : hasNextPage ? (
              <Button variant="outline" onClick={() => fetchNextPage()}>
                Load more
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">
                You've reached the end.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
