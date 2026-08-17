import { useMemo } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { countUnread, useNotifications, useNotificationsSeen } from '@/hooks/useNotifications';
import { useRelayHealthMetrics } from '@/hooks/useRelayStatus';
import { readRelays } from '@/lib/relay';
import { countReachable, formatCount } from '@/lib/navBadges';
import type { NavBadge } from '@/components/layout/navigation';

/**
 * The live figures shown at the end of the nav rows.
 *
 * Both come from state the app already holds: the notifications query is the
 * same one the header badge and the notifications page share, and the relay
 * monitor is entirely local. Neither adds a request.
 */
export function useNavBadges(): Partial<Record<NavBadge, string>> {
  const { notifications } = useNotifications();
  const { lastSeen } = useNotificationsSeen();
  const { config } = useAppContext();
  const metrics = useRelayHealthMetrics();

  const unread = countUnread(notifications, lastSeen);

  const relays = useMemo(() => {
    const configured = readRelays(config.relays);
    if (!configured.length) return '';

    const { up, total } = countReachable(configured, metrics);

    // A count of itself says nothing; the fraction is the whole message
    return `${up}/${total}`;
  }, [config.relays, metrics]);

  return {
    unread: formatCount(unread) || undefined,
    relays: relays || undefined,
  };
}
