import { useState, useEffect } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostr } from '@nostrify/react';
import { Badge } from '@/components/ui/badge';
import { Bell } from 'lucide-react';

export function NotificationBadge() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    let isSubscribed = true;

    const checkNotifications = async () => {
      try {
        // Check for mentions and replies
        const mentions = await nostr.query([
          {
            kinds: [1],
            '#p': [user.pubkey],
            since: Math.floor(Date.now() / 1000) - (24 * 60 * 60), // Last 24 hours
            limit: 50,
          }
        ], { signal: AbortSignal.timeout(3000) });

        if (isSubscribed) {
          setUnreadCount(mentions.length);
        }
      } catch (error) {
        console.error('Failed to check notifications:', error);
      }
    };

    checkNotifications();

    // Check every 5 minutes
    const interval = setInterval(checkNotifications, 5 * 60 * 1000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [user, nostr]);

  if (!user || unreadCount === 0) {
    return (
      <div className="relative">
        <Bell className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative">
      <Bell className="h-5 w-5 text-muted-foreground" />
      <Badge 
        variant="destructive" 
        className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center text-xs animate-pulse"
      >
        {unreadCount > 99 ? '99+' : unreadCount}
      </Badge>
    </div>
  );
}