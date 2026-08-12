import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { useLocalStorage } from '@/hooks/useLocalStorage';
import {
  GROUP_LIST,
  findGroupMoves,
  type GroupAdmin,
  type GroupMoveReport,
} from '@/lib/nip29';

/**
 * Noticing that a group has moved or forked.
 *
 * NIP-29 makes this a client's job because a group is only as durable as the
 * relay enforcing it: "clients SHOULD periodically -- and MUST, if their
 * primary relay for a group is offline or unreachable -- look at the
 * kind:10009 event of the group's admins".
 *
 * The catch is where the admin list lives. It is the group's own kind:39001,
 * published by the relay that just stopped answering — so a client that only
 * learns who the admins are by asking that relay can never run the check in
 * precisely the case the spec makes mandatory. Hence the cache: admins are
 * written down locally whenever the group is reachable, so they are still
 * known when it is not.
 */

const CACHE_KEY = 'nip29:admins';

type AdminCache = Record<string, string[]>;

function cacheKey(relayUrl: string, groupId: string): string {
  return `${relayUrl}|${groupId}`;
}

/**
 * Remembers a group's admins for when its relay stops answering.
 *
 * Keyed by relay *and* id, never id alone. The same id on two relays is two
 * different groups with possibly different admins — the spec calls that a
 * fork and treats it as a feature — so merging them would let one community's
 * admins speak for another's.
 */
export function useCachedGroupAdmins(
  relayUrl: string | undefined,
  groupId: string | undefined,
  admins?: GroupAdmin[]
) {
  const [cache, setCache] = useLocalStorage<AdminCache>(CACHE_KEY, {});

  const key = relayUrl && groupId ? cacheKey(relayUrl, groupId) : undefined;
  const pubkeys = admins?.map((admin) => admin.pubkey) ?? [];
  const fingerprint = pubkeys.join(',');

  useEffect(() => {
    if (!key || !fingerprint) return;

    setCache((current) => {
      // Written only on a change, so this does not touch storage every render
      if (current[key]?.join(',') === fingerprint) return current;
      return { ...current, [key]: fingerprint.split(',') };
    });
  }, [key, fingerprint, setCache]);

  return key ? (cache[key] ?? []) : [];
}

/**
 * Where a group's admins now say it lives.
 *
 * Runs against the app's normal relay pool rather than the group's own relay,
 * which is the entire point: the check has to work when that relay is the
 * thing that has gone away.
 */
export function useGroupMoves(
  groupId: string | undefined,
  relayUrl: string | undefined,
  adminPubkeys: string[],
  enabled = true
): { report: GroupMoveReport | null; isLoading: boolean } {
  const { nostr } = useNostr();

  const authors = [...new Set(adminPubkeys)].sort();

  const query = useQuery({
    queryKey: ['nip29-moves', groupId ?? '', relayUrl ?? '', authors.join(',')],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [{ kinds: [GROUP_LIST], authors, limit: authors.length * 2 }],
        { signal }
      );

      /**
       * One list per admin, the newest. A replaceable event can come back in
       * several revisions, and an old one may still name the relay the group
       * has already left — which would report a move that has finished as if
       * it were pending.
       */
      const newest = new Map<string, (typeof events)[number]>();

      for (const event of events) {
        const existing = newest.get(event.pubkey);
        if (!existing || existing.created_at < event.created_at) {
          newest.set(event.pubkey, event);
        }
      }

      return findGroupMoves(
        groupId!,
        [...newest].map(([pubkey, event]) => ({ pubkey, event })),
        relayUrl
      );
    },
    enabled: enabled && !!groupId && authors.length > 0,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  return {
    report: query.data?.candidates.length ? query.data : null,
    isLoading: query.isLoading,
  };
}
