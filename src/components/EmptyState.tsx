import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { RelaySelector } from '@/components/RelaySelector';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Shows the relay picker, so users can look for content elsewhere. */
  showRelaySelector?: boolean;
  action?: ReactNode;
  className?: string;
}

/** Shared empty/error placeholder used across feeds, profiles and search. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  showRelaySelector = false,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn('border-dashed', className)}>
      <CardContent className="px-6 py-12 text-center">
        <div className="mx-auto max-w-sm space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Icon className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold">{title}</h3>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
          {showRelaySelector && (
            <div className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                Try a different relay
              </p>
              <RelaySelector className="w-full" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
