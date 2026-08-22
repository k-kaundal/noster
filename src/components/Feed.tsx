import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Film, Loader2, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { useFeed, type FeedScope } from '@/hooks/useFeed';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAccountStored } from '@/hooks/useStore';
import { useAdvancedFilters } from '@/hooks/useAdvancedFilters';
import { Post } from '@/components/Post';
import { PostSkeletonList } from '@/components/PostSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { AdvancedFiltersButton } from '@/components/AdvancedFilters';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingHashtags, TrendingPeople } from '@/components/TrendingCards';
import { useTrending } from '@/hooks/useTrending';
import { useContentFilter } from '@/hooks/useContentFilter';
import { useFeedSpam } from '@/hooks/useFeedSpam';
import { FilteredNotice } from '@/components/FilteredNotice';
import { countUnseen, markerFor, type FeedMarker } from '@/lib/feedPosition';
import { cn } from '@/lib/utils';

export function Feed() {
  const { user } = useCurrentUser();

  /**
   * Remembered per account.
   *
   * Someone who reads their Following tab was sent back to Global by every
   * visit to a post and every reload — a preference re-stated a dozen times a
   * session and never once kept. Per account, because whose follows they are
   * is the whole difference between the two tabs.
   */
  const [scope, setScope] = useAccountStored<FeedScope>('feed:scope', 'global');

  const {
    posts: rawPosts,
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
  const { filters } = useAdvancedFilters();
  const { filter: filterContent } = useContentFilter();

  // Muted authors, words and hashtags never reach the timeline
  const posts = useMemo(() => {
    if (!rawPosts) return rawPosts;

    /*
     * Mute, adult content and machine payloads, in one place shared with every
     * other screen that renders notes — see `useContentFilter`. They used to
     * be written out here, which is why they applied to this timeline and to
     * nothing else.
     */
    let filtered = filterContent(rawPosts) ?? [];

    // Apply advanced filters if enabled
    if (filters.enabled) {
      filtered = filtered.filter((post) => {
        // Hide replies if filter is enabled
        if (filters.hideReplies && post.tags.some(([name]) => name === 'e')) {
          return false;
        }

        // Hide reposts if filter is enabled
        if (filters.hideReposts && (post.kind === 6 || post.kind === 16)) {
          return false;
        }

        // Filter by content type
        if (
          filters.contentTypes.length > 0 &&
          !filters.contentTypes.includes('all')
        ) {
          const hasImage = post.tags.some(([name, value]) =>
            name === 'imeta' || (name === 'media' && value?.includes('image'))
          );
          const hasVideo = post.tags.some(([name, value]) =>
            (name === 'imeta' && value?.includes('video')) ||
            (name === 'media' && value?.includes('video'))
          );
          const isArticle = post.kind === 23;

          if (
            filters.contentTypes.includes('image') && !hasImage ||
            filters.contentTypes.includes('video') && !hasVideo ||
            filters.contentTypes.includes('article') && !isArticle ||
            filters.contentTypes.includes('text') && (hasImage || hasVideo || isArticle)
          ) {
            return false;
          }
        }

        // Filter by engagement (check tags for engagement metrics)
        if (filters.minEngagement > 0) {
          const replies = parseInt(post.tags.find(([name]) => name === 'replies')?.[1] ?? '0');
          const reposts = parseInt(post.tags.find(([name]) => name === 'reposts')?.[1] ?? '0');
          const reactions = parseInt(post.tags.find(([name]) => name === 'reactions')?.[1] ?? '0');
          const totalEngagement = replies + reposts + reactions;

          if (totalEngagement < filters.minEngagement) {
            return false;
          }
        }

        return true;
      });
    }

    return filtered;
  }, [rawPosts, filters, filterContent]);

  // Track the newest note the reader has actually seen, so the "new posts"
  // pill only counts notes that arrived after they arrived on the page.
  const [seenTop, setSeenTop] = useState<FeedMarker | null>(null);

  /**
   * Where the timeline the reader is looking at starts.
   *
   * Anything above this arrived after they did — from the live subscription,
   * a poll, or a refetch. Counting it is useful; showing it is not. A note
   * inserted at the top pushes everything down by its own height, which moves
   * the paragraph someone is halfway through reading, and does it again every
   * time another one lands.
   */
  const firstUnseen = useMemo(() => countUnseen(posts, seenTop), [posts, seenTop]);

  const newCount = firstUnseen;

  /** The held-back notes are dropped until the reader asks for them. */
  const unseenTrimmed = useMemo(
    () => (posts && firstUnseen > 0 ? posts.slice(firstUnseen) : posts),
    [posts, firstUnseen]
  );

  /*
   * Campaigns and blank-profile link drops, judged by the same code that has
   * been filtering notifications all along — see `useFeedSpam`. Never applied
   * to the Following tab: those are accounts somebody chose, and a filter that
   * second-guesses a deliberate follow is worse than the spam it catches.
   */
  const judgeSpam = scope !== 'following';
  const spam = useFeedSpam(judgeSpam ? unseenTrimmed : undefined);
  const [showSpam, setShowSpam] = useState(false);

  /*
   * The unjudged list when the judge was not asked, rather than its answer.
   *
   * `useFeedSpam` hands back whatever it was given, so switched off it hands
   * back `undefined` — which rendered the Following tab as an empty list under
   * a spinner that never stopped, because the notes were all there and none of
   * them were being mapped over.
   */
  const visiblePosts =
    judgeSpam && !showSpam ? spam.kept : unseenTrimmed;

  useEffect(() => {
    if (posts?.length && !seenTop) setSeenTop(markerFor(posts[0]));
  }, [posts, seenTop]);

  const showNewPosts = () => {
    if (posts?.length) setSeenTop(markerFor(posts[0]));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRefresh = async () => {
    await refetch();
    setSeenTop(null);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Tabs
          value={scope}
          onValueChange={(value) => {
            setScope(value as FeedScope);
            setSeenTop(null);
          }}
        >
          <TabsList>
            <TabsTrigger value="global">Global</TabsTrigger>
            <TabsTrigger value="following" disabled={!user}>
              Following
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <AdvancedFiltersButton />
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
      </div>

      {newCount > 0 && (
        <div className="sticky top-[calc(var(--header-height)+0.5rem)] z-30 flex justify-center">
          <Button
            size="sm"
            onClick={showNewPosts}
            className="animate-slide-down rounded-full shadow-float"
          >
            <ArrowUp className="mr-1.5 h-3.5 w-3.5" />
            {newCount} new {newCount === 1 ? 'post' : 'posts'}
          </Button>
        </div>
      )}

      {/* Entry point to the vertical video feed */}
      <Link
        to="/reels"
        className="group flex items-center gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:bg-muted/40"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
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
      <div className="grid gap-3 sm:grid-cols-2 xl:hidden">
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

      {/* A failed refresh on top of notes we already have is a banner, not an
          empty state — throwing away a readable feed because the newest
          request timed out is the worse of the two outcomes */}
      {isError && !!posts?.length && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
          <p className="text-sm">
            Couldn't reach the relay. Showing what you had.
          </p>
          <Button variant="ghost" size="sm" onClick={handleRefresh}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <PostSkeletonList />
      ) : isError && !posts?.length ? (
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
              <Button asChild>
                <Link to="/compose">Write the first note</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="stagger-in space-y-3">
            {visiblePosts?.map((post, index) => (
              <div
                key={post.id}
                // Capped so late items in a long list still appear promptly
                style={
                  { '--stagger-index': Math.min(index, 8) } as React.CSSProperties
                }
              >
                <Post event={post} />
              </div>
            ))}
          </div>

          {/* Never silence. A filter nobody can inspect is indistinguishable
              from a bug, and the note it gets wrong is the one somebody most
              needs to find. */}
          <FilteredNotice
            count={spam.filtered.length}
            reasons={spam.reasons}
            open={showSpam}
            onToggle={() => setShowSpam((open) => !open)}
          />

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
