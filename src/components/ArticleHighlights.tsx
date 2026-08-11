import { Highlighter } from 'lucide-react';
import { HighlightCard } from '@/components/HighlightCard';
import { useHighlights } from '@/hooks/useHighlights';
import { cn } from '@/lib/utils';

/**
 * What other people picked out of this article.
 *
 * Shown under the piece rather than inline over it. Marking the passages in
 * the text itself would be better reading, and would also mean re-finding
 * arbitrary strings inside rendered markdown on every load — worth doing
 * eventually, not worth a fragile match now.
 */
export function ArticleHighlights({
  address,
  className,
}: {
  address: string;
  className?: string;
}) {
  const { data: highlights } = useHighlights({ address });

  if (!highlights?.length) return null;

  return (
    <section className={cn('space-y-3 border-t pt-5', className)}>
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Highlighter className="h-4 w-4" />
        {highlights.length === 1
          ? '1 highlight'
          : `${highlights.length} highlights`}
      </h2>

      {highlights.slice(0, 10).map((highlight) => (
        <HighlightCard key={highlight.event.id} event={highlight.event} />
      ))}
    </section>
  );
}
