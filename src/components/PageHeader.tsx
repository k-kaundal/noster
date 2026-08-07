import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Consistent title block for top-level pages. */
export function PageHeader({
  icon: Icon,
  title,
  description,
  action,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0 space-y-1.5">
        <h1 className="flex items-center gap-2.5 text-title">
          {Icon && (
            <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{title}</span>
        </h1>
        {description && (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
