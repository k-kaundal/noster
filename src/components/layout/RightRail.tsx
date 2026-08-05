import { Link } from 'react-router-dom';
import { useTrending } from '@/hooks/useTrending';
import { SuggestedFollows } from '@/components/SuggestedFollows';
import { TrendingHashtags, TrendingPeople } from '@/components/TrendingCards';
import { cn } from '@/lib/utils';

/** Secondary column of discovery widgets, shown from the `xl` breakpoint up. */
export function RightRail({ className }: { className?: string }) {
  const { data, isLoading } = useTrending();

  return (
    <div className={cn('space-y-4', className)}>
      <SuggestedFollows />
      <TrendingHashtags hashtags={data?.topHashtags ?? []} isLoading={isLoading} />
      <TrendingPeople mentions={data?.topMentions ?? []} isLoading={isLoading} />

      <nav className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
        <Link to="/explore" className="hover:text-foreground hover:underline">
          Explore
        </Link>
        <Link to="/trending" className="hover:text-foreground hover:underline">
          Trending
        </Link>
        <a
          href="https://soapbox.pub/mkstack"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground hover:underline"
        >
          Vibed with MKStack
        </a>
        <span>© {new Date().getFullYear()} nostrfeed.com</span>
      </nav>
    </div>
  );
}
