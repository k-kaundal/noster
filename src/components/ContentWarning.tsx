import { useState, type ReactNode } from 'react';
import { EyeOff, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type SeverityLevel = 'mild' | 'moderate' | 'explicit';

interface ContentWarningProps {
  reason?: string;
  severity?: SeverityLevel;
  children: ReactNode;
  className?: string;
}

const SEVERITY_CONFIG = {
  mild: {
    label: 'Content warning',
    color: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
    blur: 'blur-sm',
  },
  moderate: {
    label: 'Sensitive content',
    color: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
    blur: 'blur-md',
  },
  explicit: {
    label: 'Explicit content',
    color: 'bg-red-500/20 text-red-700 dark:text-red-400',
    blur: 'blur-lg',
  },
} as const;

/**
 * NIP-36 enhanced gate with severity levels and better UX.
 * The note stays mounted behind a blur rather than being withheld,
 * so revealing it is instant and layout doesn't jump.
 */
export function ContentWarning({
  reason,
  severity = 'moderate',
  children,
  className,
}: ContentWarningProps) {
  const [revealed, setRevealed] = useState(false);
  const config = SEVERITY_CONFIG[severity];

  if (revealed) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setRevealed(false)}
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Hide sensitive content"
        >
          <EyeOff className="h-3.5 w-3.5" />
          Hide sensitive content
        </button>
        {children}
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-amber-200 dark:border-amber-800', className)}>
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none max-h-48 select-none overflow-hidden saturate-50',
          config.blur
        )}
      >
        {children}
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/75 p-4 text-center backdrop-blur-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-center">
            <Badge className={config.color} variant="secondary">
              {config.label}
            </Badge>
          </div>
          {reason && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{reason}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setRevealed(true)}
          className="gap-2"
        >
          <Eye className="h-4 w-4" />
          Show anyway
        </Button>
      </div>
    </div>
  );
}
