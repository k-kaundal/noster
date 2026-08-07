import { useMemo } from 'react';
import { type NostrEvent, type NostrMetadata, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { createBatchLoader, type BatchLoader } from '@/lib/batchLoader';

export interface AuthorData {
  event?: NostrEvent;
  metadata?: NostrMetadata;
}

type Relay = ReturnType<typeof useNostr>['nostr'];

/**
 * One loader per relay pool. A feed renders dozens of avatars at once, and
 * without batching each one issued its own kind 0 query.
 */
const loaders = new WeakMap<object, BatchLoader<string, AuthorData>>();

function getLoader(nostr: Relay): BatchLoader<string, AuthorData> {
  const existing = loaders.get(nostr as object);
  if (existing) return existing;

  const loader = createBatchLoader<string, AuthorData>({
    windowMs: 60,
    maxBatchSize: 150,
    emptyValue: () => ({}),
    async fetch(pubkeys) {
      const events = await nostr.query([{ kinds: [0], authors: pubkeys }], {
        signal: AbortSignal.timeout(4000),
      });

      const results = new Map<string, AuthorData>();

      for (const event of events) {
        // Relays can return several kind 0s per author; keep the newest
        const existingEntry = results.get(event.pubkey);
        if (existingEntry?.event && existingEntry.event.created_at >= event.created_at) {
          continue;
        }

        try {
          const metadata = n.json().pipe(n.metadata()).parse(event.content);
          results.set(event.pubkey, { metadata, event });
        } catch {
          results.set(event.pubkey, { event });
        }
      }

      return results;
    },
  });

  loaders.set(nostr as object, loader);
  return loader;
}

/**
 * Metadata for many authors at once, sharing the cache and the batcher with
 * `useAuthor` — so a list of 300 follows still costs one relay query, and
 * anything the feed already loaded is reused rather than refetched.
 */
export function useAuthors(pubkeys: string[], enabled = true) {
  const { nostr } = useNostr();
  const loader = useMemo(() => getLoader(nostr), [nostr]);

  const results = useQueries({
    queries: pubkeys.map((pubkey) => ({
      queryKey: ['author', pubkey],
      queryFn: () => loader.load(pubkey),
      enabled,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
    })),
  });

  return useMemo(
    () =>
      pubkeys.map((pubkey, index) => ({
        pubkey,
        metadata: results[index]?.data?.metadata,
      })),
    [pubkeys, results]
  );
}

export function useAuthor(pubkey: string | undefined) {
  const { nostr } = useNostr();
  const loader = useMemo(() => getLoader(nostr), [nostr]);

  return useQuery<AuthorData>({
    queryKey: ['author', pubkey ?? ''],
    queryFn: async () => {
      if (!pubkey) return {};
      return loader.load(pubkey);
    },
    // Profiles change rarely, so keep them warm across navigations
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
}
