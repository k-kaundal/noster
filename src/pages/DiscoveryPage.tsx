import { useState } from 'react';
import { Compass, TrendingUp } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { Trending } from '@/components/Trending';
import { Button } from '@/components/ui/button';
import { useRouteSeo } from '@/hooks/useSeo';

type TimeRange = 'now' | '24h' | '7d' | '30d';

/**
 * Discovery page showing trending content and communities
 */
export function DiscoveryPage() {
  useRouteSeo('/discovery');

  const [timeRange, setTimeRange] = useState<TimeRange>('24h');

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Compass}
          title="Discovery"
          description="Find trending content, popular topics, rising users, and active communities."
        />

        {/* Time Range Selector */}
        <div className="flex gap-2 flex-wrap">
          {(['now', '24h', '7d', '30d'] as TimeRange[]).map((range) => {
            const labels: Record<TimeRange, string> = {
              'now': 'Right now',
              '24h': 'Last 24 hours',
              '7d': 'Last 7 days',
              '30d': 'Last 30 days',
            };

            return (
              <Button
                key={range}
                variant={timeRange === range ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTimeRange(range)}
              >
                {labels[range]}
              </Button>
            );
          })}
        </div>

        {/* Trending Section */}
        <Trending timeRange={timeRange} limit={10} />

        {/* Additional Discovery Sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Pro Tip Card */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Discover Curated Collections</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Check out user spotlights to see what others are featuring. Users share their best content and connections through their spotlight section.
                </p>
              </div>
            </div>
          </div>

          {/* Community Spotlight Card */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20">
                <Compass className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Featured Communities</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Communities highlight their best members and discussions through community spotlights. Find active communities in your interests.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default DiscoveryPage;
