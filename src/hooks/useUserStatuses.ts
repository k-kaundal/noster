import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import {
  USER_STATUS_KIND,
  isStatusActive,
  newestStatuses,
  type StatusType,
  type UserStatus,
} from '@/lib/nip38';

/** Long enough for a relay to answer with a handful of statuses. */
const TIMEOUT = 4000;

/**
 * The statuses for one person, indexed by type.
 *
 * A status is an addressable event, so the same person publishes the same
 * address again when it changes — only the newest is kept. Anything that is
 * expired, blank, or older than the staleness window is filtered out before
 * it reaches the component.
 */
export function useUserStatuses(pubkey: string | undefined) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['user-statuses', pubkey],
    queryFn: async (c) => {
      if (!pubkey) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(TIMEOUT)]);

      const events = await nostr.query(
        [{ kinds: [USER_STATUS_KIND], authors: [pubkey], limit: 20 }],
        { signal }
      );

      return newestStatuses(events).filter((status) => isStatusActive(status));
    },
    enabled: !!pubkey,
    staleTime: 60_000,
  });

  const byType = useMemo(() => {
    const map = new Map<StatusType, UserStatus>();
    for (const status of query.data ?? []) {
      map.set(status.type, status);
    }
    return map;
  }, [query.data]);

  return {
    statuses: query.data ?? [],
    byType,
    general: byType.get('general'),
    music: byType.get('music'),
    isLoading: query.isLoading,
  };
}

/**
 * Statuses for many people at once, keyed by pubkey.
 *
 * The profile card and the follower list both want the same answer for
 * different people, and asking for each in turn is the kind of N+1 that makes
 * a page feel slow. One filter with every author is what a relay is for.
 */
export function useUserStatusesFor(pubkeys: readonly string[]) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['user-statuses-for', pubkeys.slice().sort()],
    queryFn: async (c) => {
      if (!pubkeys.length) return new Map<string, UserStatus[]>();

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(TIMEOUT)]);

      const events = await nostr.query(
        [{ kinds: [USER_STATUS_KIND], authors: [...pubkeys], limit: 100 }],
        { signal }
      );

      const active = newestStatuses(events).filter((status) =>
        isStatusActive(status)
      );

      const byAuthor = new Map<string, UserStatus[]>();
      for (const status of active) {
        const list = byAuthor.get(status.author) ?? [];
        list.push(status);
        byAuthor.set(status.author, list);
      }
      return byAuthor;
    },
    enabled: pubkeys.length > 0,
    staleTime: 60_000,
  });

  return {
    byAuthor: query.data ?? new Map<string, UserStatus[]>(),
    isLoading: query.isLoading,
  };
}
