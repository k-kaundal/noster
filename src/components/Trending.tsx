import { Flame } from 'lucide-react';
import { useTrending } from '@/hooks/useTrending';
import { Post } from '@/components/Post';
import { PageHeader } from '@/components/PageHeader';
import { PostSkeletonList } from '@/components/PostSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { TrendingHashtags, TrendingPeople } from '@/components/TrendingCards';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function Trending() {
  const { data, isLoading, error } = useTrending();

  const {
    popularPosts = [],
    topHashtags = [],
    topMentions = [],
  } = data || {};

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Flame}
        title="Trending"
        description="What the last 24 hours look like on this relay."
      />

      {error ? (
        <EmptyState
          icon={Flame}
          title="Couldn't load trending content"
          description="The relay didn't respond in time."
          showRelaySelector
        />
      ) : (
        <Tabs defaultValue="posts" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="posts" className="flex-1 sm:flex-none">
              Posts
            </TabsTrigger>
            <TabsTrigger value="hashtags" className="flex-1 sm:flex-none">
              Hashtags
            </TabsTrigger>
            <TabsTrigger value="people" className="flex-1 sm:flex-none">
              People
            </TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="space-y-4">
            {isLoading ? (
              <PostSkeletonList count={4} />
            ) : popularPosts.length === 0 ? (
              <EmptyState
                icon={Flame}
                title="Nothing trending yet"
                description="This relay hasn't seen much activity recently."
                showRelaySelector
              />
            ) : (
              popularPosts.map((post) => <Post key={post.id} event={post} />)
            )}
          </TabsContent>

          <TabsContent value="hashtags">
            <TrendingHashtags
              hashtags={topHashtags}
              isLoading={isLoading}
              limit={10}
            />
          </TabsContent>

          <TabsContent value="people">
            <TrendingPeople
              mentions={topMentions}
              isLoading={isLoading}
              limit={10}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
