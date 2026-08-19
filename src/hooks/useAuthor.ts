import { useMemo } from 'react';
import { type NostrEvent, type NostrMetadata, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import {
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { createBatchLoader, type BatchLoader } from '@/lib/batchLoader';
import { reconcileAuthor, shouldReplaceProfile } from '@/lib/authorCache';
import { RELAY_LIST_KIND } from '@/lib/outboxRouting';

export interface AuthorData {
  event?: NostrEvent;
  metadata?: NostrMetadata;
}

/** The cache entry a profile lives at, in one place so writers agree with readers. */
export function authorQueryKey(pubkey: string | undefined) {
  return ['author', pubkey ?? ''] as const;
}

/** A kind 0 event turned into what the rest of the app reads. */
export function readAuthorEvent(event: NostrEvent): AuthorData {
  try {
    return { metadata: n.json().pipe(n.metadata()).parse(event.content), event };
  } catch {
    return { event };
  }
}

/**
 * Puts a profile someone just published into the cache.
 *
 * Without this, publishing a kind 0 changed nothing on screen. The cache is
 * written when a profile is first *read*, which for a new account happens the
 * moment they log in — before they have published anything, so what gets
 * stored is "this key has no profile", and it is stored as a fact for the next
 * half hour. Signing up then filling in a name left that entry untouched, so
 * the new account's own profile page showed a generated name and a grey circle
 * until the entry expired.
 *
 * Seeded from the signed event rather than invalidated, deliberately.
 * Invalidating asks the relays, and the relay has usually not indexed the
 * event yet — the answer comes back empty and overwrites the truth with the
 * same nothing. The event in hand is signed and is what the relays will serve
 * once they catch up.
 */
export function cacheAuthorEvent(client: QueryClient, event: NostrEvent): void {
  if (event.kind !== 0) return;

  client.setQueryData<AuthorData>(authorQueryKey(event.pubkey), (existing) =>
    shouldReplaceProfile(event, existing?.event)
      ? readAuthorEvent(event)
      : existing
  );
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
      /**
       * Kind 10002 travels with kind 0, and that is what makes outbox routing
       * actually happen.
       *
       * The routing table in `lib/outboxRouting` is filled by harvesting relay
       * lists as they cross the pool — but nothing was putting any there. A
       * profile view fetched kind 0 alone, so opening somebody's page taught
       * this app nothing about where they publish, and their notes were then
       * fetched from the reader's own relays exactly as before. The mechanism
       * was built and left unfed.
       *
       * Asking for both costs nothing: it is the same batch, the same round
       * trip, and both kinds are in `INDEXED_KINDS`, so the request still
       * qualifies as an identity lookup and still goes to the NIP-65 indexers
       * that exist to answer it. The pool harvests what comes back, and the
       * *next* query for this author's events is routed to their own relays.
       */
      const events = await nostr.query(
        [{ kinds: [0, RELAY_LIST_KIND], authors: pubkeys }],
        { signal: AbortSignal.timeout(4000) }
      );

      const results = new Map<string, AuthorData>();

      for (const event of events) {
        /*
         * Only kind 0 is a profile. The relay lists are here to be harvested
         * by the pool on the way past, not to be read as metadata — and
         * letting one through would replace somebody's name and avatar with an
         * event that has neither, since it is usually the newer of the two.
         */
        if (event.kind !== 0) continue;

        // Relays can return several kind 0s per author; keep the newest
        const existingEntry = results.get(event.pubkey);
        if (existingEntry?.event && existingEntry.event.created_at >= event.created_at) {
          continue;
        }

        results.set(event.pubkey, readAuthorEvent(event));
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
/**
 * How long a profile stays trusted.
 *
 * Someone changes their name or avatar a handful of times a year, and a feed
 * of thirty notes asks about thirty of them. Half an hour keeps names and
 * avatars on screen through a session without a relay round trip, and the
 * restored cache means they are there before the first one even opens.
 */
const PROFILE_STALE_TIME = 30 * 60 * 1000;

/** Kept for a day, so moving around the app never redraws a grey circle. */
const PROFILE_GC_TIME = 24 * 60 * 60 * 1000;

/**
 * Refetch a profile that has gone stale, even though the app does not do that
 * anywhere else.
 *
 * The global default is `refetchOnMount: false`, which is right for a feed —
 * going back to a page should paint from cache rather than re-querying. For
 * profiles it was a trap: the cache is also restored from the last visit, so a
 * name and avatar that were wrong once stayed wrong across reloads with
 * nothing ever asking again. Stale here means "older than half an hour", not
 * "every mount".
 */
const PROFILE_REFETCH_ON_MOUNT = true;

export function useAuthors(pubkeys: string[], enabled = true) {
  const { nostr } = useNostr();
  const client = useQueryClient();
  const loader = useMemo(() => getLoader(nostr), [nostr]);

  const results = useQueries({
    queries: pubkeys.map((pubkey) => ({
      queryKey: authorQueryKey(pubkey),
      queryFn: async () =>
        reconcileAuthor(
          await loader.load(pubkey),
          client.getQueryData<AuthorData>(authorQueryKey(pubkey))
        ),
      enabled,
      staleTime: PROFILE_STALE_TIME,
      gcTime: PROFILE_GC_TIME,
      refetchOnMount: PROFILE_REFETCH_ON_MOUNT,
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
  const client = useQueryClient();
  const loader = useMemo(() => getLoader(nostr), [nostr]);

  return useQuery<AuthorData>({
    queryKey: authorQueryKey(pubkey),
    queryFn: async () => {
      if (!pubkey) return {};

      return reconcileAuthor(
        await loader.load(pubkey),
        client.getQueryData<AuthorData>(authorQueryKey(pubkey))
      );
    },
    staleTime: PROFILE_STALE_TIME,
    gcTime: PROFILE_GC_TIME,
    refetchOnMount: PROFILE_REFETCH_ON_MOUNT,
    retry: 1,
  });
}
