import { useState } from 'react';
import { ChevronDown, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CollapsedPostProps {
  reason: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Soft-mute component: collapse post with option to expand.
 * Better UX than hard-hiding - user can still choose to see muted content.
 */
export function CollapsedPost({ reason, children, className }: CollapsedPostProps) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-label={`Collapse muted post: ${reason}`}
        >
          <ChevronDown className="h-3.5 w-3.5" />
          Hide muted post
        </button>
        {children}
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border border-dashed border-muted-foreground/30 p-3.5', className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(true)}
        className="gap-2 text-muted-foreground hover:text-foreground"
      >
        <Volume2 className="h-4 w-4" />
        <span className="text-xs">
          Muted: <span className="font-medium">{reason}</span>
        </span>
      </Button>
    </div>
  );
}
