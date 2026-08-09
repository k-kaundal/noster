import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import {
  TrendingUp,
  Flame,
  Hash,
  Users,
  MessageSquare,
} from 'lucide-react';
import {
  useTrendingPosts,
  useTrendingHashtags,
  useTrendingUsers,
  useTrendingCommunities,
  type TrendingItem,
} from '@/hooks/useTrending';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface TrendingProps {
  timeRange?: 'now' | '24h' | '7d' | '30d';
  limit?: number;
}

/**
 * Trending section showing popular posts, hashtags, users, and communities
 */
export function Trending({ timeRange = '24h', limit = 10 }: TrendingProps) {
  const hours = timeRange === 'now' ? 1 : timeRange === '24h' ? 24 : timeRange === '7d' ? 168 : 720;

  const { data: posts, isLoading: postsLoading } = useTrendingPosts(hours, limit);
  const { data: hashtags, isLoading: hashtagsLoading } = useTrendingHashtags(hours, limit);
  const { data: users, isLoading: usersLoading } = useTrendingUsers(hours, limit);
  const { data: communities, isLoading: communitiesLoading } = useTrendingCommunities(hours, limit);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Flame className="h-6 w-6 text-orange-500" />
        <h2 className="text-2xl font-bold">Trending</h2>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Trending Posts */}
        <TrendingCard
          title="Popular Posts"
          icon={MessageSquare}
          items={posts}
          isLoading={postsLoading}
          renderItem={(item) => (
            <Link
              to={`/${nip19.noteEncode(item.id)}`}
              className="block truncate hover:text-primary hover:underline"
            >
              {item.title}
            </Link>
          )}
        />

        {/* Trending Hashtags */}
        <TrendingCard
          title="Trending Topics"
          icon={Hash}
          items={hashtags}
          isLoading={hashtagsLoading}
          renderItem={(item) => (
            <Link
              to={`/search?q=${encodeURIComponent(item.title)}`}
              className="block truncate hover:text-primary hover:underline font-medium"
            >
              {item.title}
            </Link>
          )}
        />

        {/* Trending Users */}
        <TrendingCard
          title="Rising Users"
          icon={Users}
          items={users}
          isLoading={usersLoading}
          renderItem={(item) => (
            <Link
              to={`/${item.id}`}
              className="block truncate hover:text-primary hover:underline"
            >
              {item.title}
            </Link>
          )}
        />

        {/* Trending Communities */}
        <TrendingCard
          title="Active Communities"
          icon={Users}
          items={communities}
          isLoading={communitiesLoading}
          renderItem={(item) => (
            <Link
              to={`/community/${item.id}`}
              className="block truncate hover:text-primary hover:underline"
            >
              {item.title}
            </Link>
          )}
        />
      </div>
    </div>
  );
}

interface TrendingCardProps {
  title: string;
  icon: typeof TrendingUp;
  items?: TrendingItem[];
  isLoading: boolean;
  renderItem: (item: TrendingItem, index: number) => React.ReactNode;
}

function TrendingCard({
  title,
  icon: Icon,
  items = [],
  isLoading,
  renderItem,
}: TrendingCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 rounded" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No trending items yet
          </p>
        ) : (
          <ol className="space-y-2">
            {items.slice(0, 5).map((item, index) => (
              <li
                key={item.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg p-2 hover:bg-muted/50 transition-colors text-sm',
                  index === 0 && 'bg-primary/5'
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded font-bold text-xs',
                    index === 0 && 'bg-orange-500/20 text-orange-600'
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {renderItem(item, index)}
                  {item.engagementScore > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      ⚡ {item.engagementScore.toLocaleString()} engagement
                    </p>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
