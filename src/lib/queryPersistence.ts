import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';
import { onStorageFull } from '@/lib/store';

/**
 * Keeps part of the query cache across reloads.
 *
 * Nostr is slow to start from nothing. Opening the app meant an empty screen
 * while a websocket opened to each relay, a subscription went out, and every
 * author in the result was looked up before a single name or avatar could be
 * drawn — several seconds of skeletons for content the browser had already
 * been shown minutes earlier.
 *
 * So the last view is saved and restored synchronously before React renders.
 * The feed paints immediately from it and refetches in the background; nothing
 * here changes what is fetched, only when the reader first sees something.
 *
 * Built on the `dehydrate`/`hydrate` pair that ships with the query library
 * rather than its persistence add-on, which is a separate package.
 */

const STORAGE_KEY = 'nostr:query-cache';

/**
 * Bumped whenever the shape of a cached value changes.
 *
 * Restoring last week's shape into this week's components is how a cache
 * turns into a crash, so a mismatch throws the whole thing away.
 */
const VERSION = 1;

/** Past this, a restored cache is more misleading than helpful. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * localStorage is a few megabytes shared with everything else the app stores,
 * and writing near the limit throws. Well under it by design.
 */
export const MAX_BYTES = 1_500_000;

/**
 * Which caches are worth keeping.
 *
 * Profiles first: they are the difference between a feed of names and a feed
 * of grey circles, they are small, and they rarely change. The feed itself is
 * next, so there is something to read at all.
 *
 * Deliberately excluded: anything from the wallet (`lnbits-*`), which is a
 * balance that must never be shown stale, and anything private (`direct-
 * messages`) that has no business surviving in plain text on a shared device.
 */
const PERSISTED = new Set(['author', 'feed', 'follows', 'relay-list']);

export interface StoredCache {
  version: number;
  savedAt: number;
  state: unknown;
}

/** Whether one query belongs in storage. */
export function shouldPersistKey(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === 'string' && PERSISTED.has(queryKey[0]);
}

/** Whether a stored cache is recent enough and of the right shape to restore. */
export function isRestorable(
  stored: unknown,
  now = Date.now()
): stored is StoredCache {
  if (!stored || typeof stored !== 'object') return false;

  const cache = stored as Partial<StoredCache>;

  return (
    cache.version === VERSION &&
    typeof cache.savedAt === 'number' &&
    now - cache.savedAt < MAX_AGE_MS &&
    !!cache.state
  );
}

/** Reads a cache back into a fresh client. Silent about anything unusable. */
export function restoreQueryCache(client: QueryClient): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const stored: unknown = JSON.parse(raw);

    if (!isRestorable(stored)) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    hydrate(client, stored.state);
  } catch {
    // A corrupt or oversized cache is not worth a broken app; the network
    // still has everything in it
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage disabled entirely (private mode, blocked cookies)
    }
  }
}

/** Serialises the persistable part of a cache, or null when it is too big. */
export function serializeCache(
  client: QueryClient,
  now = Date.now()
): string | null {
  const state = dehydrate(client, {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' &&
      query.state.data !== undefined &&
      shouldPersistKey(query.queryKey),
  });

  const payload: StoredCache = { version: VERSION, savedAt: now, state };
  const serialized = JSON.stringify(payload);

  return serialized.length > MAX_BYTES ? null : serialized;
}

/**
 * Starts saving the cache as it changes.
 *
 * Throttled rather than written on every event: a feed arriving fires one
 * cache update per query, and serialising the whole thing each time would
 * spend more of the main thread on bookkeeping than on rendering.
 *
 * Returns a function that stops it, which nothing in the app calls — the
 * subscription lives as long as the page does — but tests do.
 */
export function persistQueryCache(
  client: QueryClient,
  throttleMs = 3000
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const write = () => {
    timer = undefined;

    try {
      const serialized = serializeCache(client);

      // Too big to store is not an error worth surfacing; it just means this
      // reader's next visit starts cold
      if (serialized === null) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Quota exceeded or storage unavailable. Dropping what is there frees
      // room for the next attempt rather than failing every time from now on
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing further to try
      }
    }
  };

  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (timer) return;
    timer = setTimeout(write, throttleMs);
  });

  /**
   * This is the first thing to go when storage fills up.
   *
   * It is the largest thing the app stores and the only one that can be
   * rebuilt from the network, so a setting someone chose should never be the
   * write that fails while a cache of last night's feed keeps its room.
   */
  const unregister = onStorageFull(clearQueryCache);

  return () => {
    unsubscribe();
    unregister();
    if (timer) clearTimeout(timer);
  };
}

/** Forgets the stored cache. Used when signing out. */
export function clearQueryCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable
  }
}
