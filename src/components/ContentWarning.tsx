import { useState, type ReactNode } from 'react';
import { EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ContentWarningProps {
  reason?: string;
  children: ReactNode;
  className?: string;
}

/**
 * NIP-36 gate. The note stays mounted behind a blur rather than being withheld,
 * so revealing it is instant and layout doesn't jump.
 */
export function ContentWarning({
  reason,
  children,
  className,
}: ContentWarningProps) {
  const [revealed, setRevealed] = useState(false);

  if (revealed) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setRevealed(false)}
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <EyeOff className="h-3.5 w-3.5" />
          Hide sensitive content
        </button>
        {children}
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden rounded-lg border', className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none max-h-40 select-none overflow-hidden blur-md saturate-50"
      >
        {children}
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 p-4 text-center backdrop-blur-sm">
        <p className="text-sm font-medium">Sensitive content</p>
        {reason && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{reason}</p>
        )}
        <Button size="sm" variant="secondary" onClick={() => setRevealed(true)}>
          Show anyway
        </Button>
      </div>
    </div>
  );
}
