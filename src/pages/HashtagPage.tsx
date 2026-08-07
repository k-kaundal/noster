import { useParams } from 'react-router-dom';
import { useSeo } from '@/hooks/useSeo';
import { Hash, Loader2 } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Post } from '@/components/Post';
import { PageHeader } from '@/components/PageHeader';
import { PostSkeletonList } from '@/components/PostSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { useHashtagFeed } from '@/hooks/useHashtagFeed';
import NotFound from '@/pages/NotFound';

export function HashtagPage() {
  const { tag } = useParams<{ tag: string }>();
  const normalized = (tag ?? '').toLowerCase();

  useSeo({
    title: `#${normalized}`,
    description: `Notes tagged #${normalized} on the Nostr network, gathered from your relays.`,
    path: `/t/${normalized}`,
  });

  const { posts, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useHashtagFeed(normalized);

  if (!normalized) return <NotFound />;

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Hash}
          title={`#${normalized}`}
          description="Notes tagged with this hashtag."
        />

        {isLoading ? (
          <PostSkeletonList count={4} />
        ) : isError || !posts?.length ? (
          <EmptyState
            icon={Hash}
            title={`Nothing tagged #${normalized}`}
            description="This relay hasn't indexed notes with this hashtag."
            showRelaySelector
          />
        ) : (
          <>
            <div className="space-y-4">
              {posts.map((post) => (
                <Post key={post.id} event={post} />
              ))}
            </div>

            {hasNextPage && (
              <div className="py-2 text-center">
                <Button
                  variant="outline"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

export default HashtagPage;
