import { ChevronDown, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NotificationRow } from '@/components/notifications/NotificationRow';
import { describeSpamReason, type SpamReason } from '@/lib/campaignSpam';
import type { Notification } from '@/lib/notifications';
import { cn } from '@/lib/utils';

/**
 * What was held back, and why.
 *
 * Shown as a count rather than as silence. A filter somebody cannot inspect is
 * indistinguishable from a bug — and the one message it gets wrong is, by
 * definition, the one they most need to find. So nothing is deleted, the
 * reason is named, and opening it is one tap.
 */
export function FilteredNotifications({
  notifications,
  reasons,
  open,
  onToggle,
  seenOnEntry,
}: {
  notifications: Notification[];
  reasons: Map<string, SpamReason[]>;
  open: boolean;
  onToggle: () => void;
  seenOnEntry: number;
}) {
  if (!notifications.length) return null;

  /*
   * Named by the commonest reason rather than listed per row. "Filtered" on
   * its own reads as censorship; "the same message was sent by several
   * accounts" is a fact somebody can check against what they see when they
   * open it.
   */
  const counts = new Map<SpamReason, number>();
  for (const notification of notifications) {
    for (const reason of reasons.get(notification.event.id) ?? []) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        onClick={onToggle}
        className="w-full justify-between text-muted-foreground"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {notifications.length} filtered
            {commonest ? ` — ${describeSpamReason(commonest).toLowerCase()}` : ''}
          </span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </Button>

      {open && (
        <Card className="overflow-hidden border-dashed">
          <ul className="divide-y opacity-75">
            {notifications.map((notification) => (
              <NotificationRow
                key={notification.event.id}
                notification={notification}
                unread={notification.createdAt > seenOnEntry}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
