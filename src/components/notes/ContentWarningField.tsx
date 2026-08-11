import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { WARNING_CATEGORIES } from '@/lib/contentWarning';
import { cn } from '@/lib/utils';

interface ContentWarningFieldProps {
  /** Distinguishes the switch from other switches on the same page. */
  id?: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  categories: string[];
  onCategoriesChange: (categories: string[]) => void;
  className?: string;
}

/**
 * The NIP-36 controls, shared by every composer.
 *
 * Categories sit above the reason box because they are the part that travels:
 * they become `l` tags, which another client can filter on, where the reason
 * is prose only a human reads. Both are optional — the tag on its own is a
 * valid warning, and a reader gets a cover either way.
 */
export function ContentWarningField({
  id = 'content-warning',
  enabled,
  onEnabledChange,
  reason,
  onReasonChange,
  categories,
  onCategoriesChange,
  className,
}: ContentWarningFieldProps) {
  const toggle = (categoryId: string) => {
    onCategoriesChange(
      categories.includes(categoryId)
        ? categories.filter((entry) => entry !== categoryId)
        : [...categories, categoryId]
    );
  };

  return (
    <div className={cn('space-y-3 rounded-lg border p-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <Label
          htmlFor={id}
          className="flex cursor-pointer items-center gap-2 text-sm font-normal"
        >
          <AlertTriangle className="h-4 w-4 text-warning" />
          Mark as sensitive
        </Label>
        <Switch id={id} checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {WARNING_CATEGORIES.map((category) => {
              const active = categories.includes(category.id);

              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggle(category.id)}
                  aria-pressed={active}
                >
                  <Badge
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer font-normal transition-colors"
                  >
                    {category.label}
                  </Badge>
                </button>
              );
            })}
          </div>

          <Input
            value={reason}
            onChange={(changed) => onReasonChange(changed.target.value)}
            placeholder="Reason (optional) — shown before the note is revealed"
            className="text-sm"
          />
        </div>
      )}
    </div>
  );
}
