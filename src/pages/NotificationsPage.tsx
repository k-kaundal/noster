import { useEffect, useMemo, useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoginArea } from '@/components/auth/LoginArea';
import { NotificationRow } from '@/components/notifications/NotificationRow';
import { FilteredNotifications } from '@/components/notifications/FilteredNotifications';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useNotifications,
  useNotificationsSeen,
} from '@/hooks/useNotifications';
import { useRouteSeo } from '@/hooks/useSeo';
import {
  NOTIFICATION_FILTERS,
  filterNotifications,
  type NotificationFilter,
} from '@/lib/notifications';

export function NotificationsPage() {
  useRouteSeo('/notifications');

  const { user } = useCurrentUser();
  const {
    notifications,
    spam,
    spamReasons,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useNotifications();
  const { lastSeen, markSeen } = useNotificationsSeen();

  const [filter, setFilter] = useState<NotificationFilter>('all');
  /**
   * Held-back notifications, off by default and one tap away.
   *
   * Never deleted: the filter catches an advert sent from a dozen fresh keys,
   * and the one thing it gets wrong is the message somebody most needs to
   * find.
   */
  const [showingSpam, setShowingSpam] = useState(false);

  // The marker is captured once so rows don't lose their unread tint while
  // the page is still open.
  const [seenOnEntry] = useState(lastSeen);

  useEffect(() => {
    if (notifications.length) markSeen(notifications[0].createdAt);
  }, [notifications, markSeen]);

  const visible = useMemo(
    () => filterNotifications(notifications, filter),
    [notifications, filter]
  );

  const hiddenVisible = useMemo(
    () => filterNotifications(spam, filter),
    [spam, filter]
  );

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Bell}
          title="Notifications"
          description="Everything addressed to you, newest first."
        />

        {!user ? (
          <EmptyState
            icon={Bell}
            title="Log in to see your notifications"
            description="Mentions, replies, reactions, reposts and zaps all land here."
            action={<LoginArea className="mx-auto max-w-60" />}
          />
        ) : (
          <>
            <Tabs
              value={filter}
              onValueChange={(value) => setFilter(value as NotificationFilter)}
            >
              <TabsList>
                {NOTIFICATION_FILTERS.map(({ value, label }) => (
                  <TabsTrigger key={value} value={value}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {isLoading ? (
              <NotificationSkeletonList />
            ) : !visible.length && !hiddenVisible.length ? (
              <EmptyState
                icon={Bell}
                title={
                  filter === 'all'
                    ? 'Nothing yet'
                    : 'Nothing of that kind yet'
                }
                description="When someone mentions, reacts to, reposts or zaps you, it shows up here."
              />
            ) : (
              <>
                <Card className="overflow-hidden">
                  <ul className="divide-y">
                    {visible.map((notification) => (
                      <NotificationRow
                        key={notification.event.id}
                        notification={notification}
                        unread={notification.createdAt > seenOnEntry}
                      />
                    ))}
                  </ul>
                </Card>

                {hiddenVisible.length > 0 && (
                  <FilteredNotifications
                    notifications={hiddenVisible}
                    reasons={spamReasons}
                    open={showingSpam}
                    onToggle={() => setShowingSpam((current) => !current)}
                    seenOnEntry={seenOnEntry}
                  />
                )}

                {hasNextPage && (
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                    >
                      {isFetchingNextPage && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Load older
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function NotificationSkeletonList() {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y">
        {Array.from({ length: 6 }).map((_, index) => (
          <li key={index} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-1/5" />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default NotificationsPage;
