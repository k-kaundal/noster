import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NotificationRow } from '@/components/notifications/NotificationRow';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  countUnread,
  useNotifications,
  useNotificationsSeen,
} from '@/hooks/useNotifications';

/** Bell button with an unread count and a preview list of recent activity. */
export function NotificationBadge() {
  const { user } = useCurrentUser();
  const { notifications, isLoading } = useNotifications();
  const { lastSeen, markSeen } = useNotificationsSeen();

  const unreadCount = countUnread(notifications, lastSeen);

  return (
    <Popover
      onOpenChange={(open) => {
        if (open && notifications.length) markSeen(notifications[0].createdAt);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications'
          }
        >
          <Bell className="h-[1.2rem] w-[1.2rem]" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex min-w-[1.1rem] items-center justify-center rounded-full bg-destructive-strong px-1 text-[10px] font-semibold leading-4 text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {unreadCount} new
            </span>
          )}
        </div>

        {!user ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Log in to see your notifications.
          </p>
        ) : isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !notifications.length ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing yet. Mentions, reposts and zaps will show up here.
          </p>
        ) : (
          <>
            <ScrollArea className="max-h-96">
              <ul className="divide-y">
                {notifications.slice(0, 20).map((notification) => (
                  <NotificationRow
                    key={notification.event.id}
                    notification={notification}
                    unread={notification.createdAt > lastSeen}
                    compact
                  />
                ))}
              </ul>
            </ScrollArea>

            <div className="border-t p-2">
              <Button asChild variant="ghost" size="sm" className="w-full">
                <Link to="/notifications">See all notifications</Link>
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
