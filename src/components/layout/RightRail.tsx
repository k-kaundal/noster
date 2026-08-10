import { useTrending } from '@/hooks/useTrending';
import { SuggestedFollows } from '@/components/SuggestedFollows';
import { TrendingHashtags, TrendingPeople } from '@/components/TrendingCards';
import { AuthorProjects } from '@/components/AuthorProjects';
import { ServicePromo } from '@/components/promo/ServicePromo';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { cn } from '@/lib/utils';

/** Secondary column of discovery widgets, shown from the `xl` breakpoint up. */
export function RightRail({ className }: { className?: string }) {
  const { data, isLoading } = useTrending();

  return (
    <div className={cn('space-y-6', className)}>
      <SuggestedFollows />
      <TrendingHashtags hashtags={data?.topHashtags ?? []} isLoading={isLoading} />
      <TrendingPeople mentions={data?.topMentions ?? []} isLoading={isLoading} />

      {/* Above the author's other projects: these are the ones a reader can
          actually use from here */}
      <ServicePromo />

      <AuthorProjects />

      <SiteFooter />
    </div>
  );
}
