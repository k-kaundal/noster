import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import {
  TrendingUp,
  Flame,
  Hash,
  Users,
  MessageSquare,
  Zap,
  ArrowUp,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import {
  useTrendingPosts,
  useTrendingHashtags,
  useTrendingUsers,
  useTrendingCommunities,
  type TrendingItem,
} from '@/hooks/useTrending';
import { useOGMetadata, extractUrlFromContent } from '@/hooks/useOGMetadata';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
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
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
            <Flame className="h-6 w-6 text-orange-500" />
          </div>
          <h2 className="text-3xl font-bold">Trending Now</h2>
        </div>
        <p className="text-sm text-muted-foreground ml-13">
          Discover what's popular right now on Nostr
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Trending Posts */}
        <TrendingCard
          title="Popular Posts"
          icon={MessageSquare}
          items={posts}
          isLoading={postsLoading}
          renderItem={(item, index) => (
            <Link
              to={`/${nip19.noteEncode(item.id)}`}
              className="block hover:text-primary hover:underline"
            >
              <PostPreview content={item.title} index={index} />
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

function formatPostPreview(content: string): string {
  if (!content) return '(empty)';

  // Check if content is a URL
  const urlPattern = /^https?:\/\/[^\s]+$/;
  if (urlPattern.test(content.trim())) {
    const url = content.trim();
    // Detect media type by extension
    if (/\.(jpg|jpeg|png|gif|webp|avif)$/i.test(url)) {
      return '[Image]';
    }
    if (/\.(mp4|webm|mov|mkv)$/i.test(url)) {
      return '[Video]';
    }
    if (/\.(mp3|wav|m4a|ogg)$/i.test(url)) {
      return '[Audio]';
    }
    return '[Link]';
  }

  try {
    // Try to parse as JSON
    const parsed = JSON.parse(content);

    // Handle different JSON structures
    if (typeof parsed === 'object' && parsed !== null) {
      // Check for common text fields
      if (parsed.title) return parsed.title.substring(0, 100);
      if (parsed.content) return parsed.content.substring(0, 100);
      if (parsed.text) return parsed.text.substring(0, 100);
      if (parsed.message) return parsed.message.substring(0, 100);
      if (parsed.name) return parsed.name.substring(0, 100);

      // Check for structured data with description
      if (parsed.description) return parsed.description.substring(0, 100);
      if (parsed.summary) return parsed.summary.substring(0, 100);

      // Fallback: show object type if recognizable
      if (parsed.type) return `[${parsed.type}]`;
    }

    return '[Structured data]';
  } catch {
    // Not JSON, truncate text content
    const trimmed = content.trim().substring(0, 100);
    // Check if it looks like just URLs in the text
    if (trimmed.startsWith('http')) {
      return '[Link]';
    }
    return trimmed;
  }
}

interface PostPreviewProps {
  content: string;
  index: number;
}

function PostPreview({ content, index }: PostPreviewProps) {
  const url = extractUrlFromContent(content);
  const { data: ogData, isLoading } = useOGMetadata(url);

  // Show OG preview if available and we have image or title
  if (ogData && (ogData.image || ogData.title || ogData.description)) {
    return (
      <div className="flex gap-2 items-start">
        {ogData.image && (
          <div className="shrink-0 overflow-hidden rounded">
            <img
              src={ogData.image}
              alt=""
              className="h-12 w-12 object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {ogData.title && (
            <p className="text-sm font-medium truncate hover:text-primary transition-colors">
              {ogData.title}
            </p>
          )}
          {ogData.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {ogData.description}
            </p>
          )}
          {ogData.siteName && (
            <p className="text-xs text-muted-foreground mt-1">
              {ogData.siteName}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    );
  }

  // Fallback to regular preview
  return <span>{formatPostPreview(content)}</span>;
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
    <Card className="overflow-hidden hover:shadow-lg transition-shadow">
      <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Icon className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              No trending items yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Check back soon for updates
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {items.slice(0, 5).map((item, index) => (
              <li
                key={item.id}
                className={cn(
                  'group flex items-center gap-3 rounded-lg p-3 transition-all',
                  'hover:bg-accent/50 border border-transparent hover:border-primary/20',
                  index === 0 && 'bg-orange-500/5 border-orange-500/20'
                )}
              >
                <div className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-bold text-xs font-semibold',
                  index === 0 ? 'bg-orange-500/20 text-orange-600' : 'bg-muted text-muted-foreground'
                )}>
                  {index === 0 && <Flame className="h-3.5 w-3.5" />}
                  {index > 0 && (index + 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {renderItem(item, index)}
                  </div>
                  {item.engagementScore > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <Zap className="h-3 w-3 text-yellow-500" />
                      <p className="text-xs text-muted-foreground">
                        {Math.round(item.engagementScore)} {item.engagementScore === 1 ? 'engagement' : 'engagements'}
                      </p>
                    </div>
                  )}
                </div>
                {index === 0 && (
                  <ArrowUp className="h-4 w-4 text-orange-500/60 shrink-0" />
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
