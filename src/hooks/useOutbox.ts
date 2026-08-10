import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useNostr } from '@nostrify/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  dequeue,
  enqueue,
  outboxKey,
  readOutbox,
  subscribeOutbox,
  type OutboxItem,
} from '@/lib/outbox';
import { readStore } from '@/lib/store';

/** Between sweeps, when nothing else has prompted one. */
const SWEEP_INTERVAL = 30_000;

/** Sends are sequential, so this bounds how long one sweep can take. */
const SEND_TIMEOUT = 6000;

/**
 * One sweep at a time, across the whole app.
 *
 * Module scope rather than a ref: the drainer at the root and a retry button
 * in the header are different components, and two sweeps would race to send
 * the same event — the loser getting a duplicate rejection it would then
 * record as a failure against a note that had in fact just been delivered.
 */
let sweeping = false;

/** Relay type is opaque here; only `event()` is used. */
type Publisher = { event: (event: unknown, opts?: unknown) => Promise<unknown> };

async function sweep(
  nostr: Publisher,
  queryClient: QueryClient
): Promise<void> {
  if (sweeping) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const items = readOutbox();
  if (!items.length) return;

  sweeping = true;

  try {
    let delivered = false;

    for (const item of items) {
      try {
        await nostr.event(item.event, {
          signal: AbortSignal.timeout(SEND_TIMEOUT),
        });

        dequeue(item.event.id);
        delivered = true;
      } catch (error) {
        // Recording the attempt is what lets someone see it is still being
        // tried rather than quietly forgotten
        enqueue(item.event, error as Error);

        // One failure usually means the network rather than this event, so
        // the rest waits for the next sweep instead of each spending its own
        // timeout on the same dead connection
        break;
      }
    }

    if (delivered) {
      // A note that has finally landed should appear where it belongs
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  } finally {
    sweeping = false;
  }
}

/**
 * Sends what is waiting, whenever sending looks possible again.
 *
 * Mounted once, near the root. A queue that only drains while the right page
 * is open is not a queue — so this runs on coming back online, on the tab
 * being looked at again, and on a slow timer for the case where the
 * connection recovered without the browser noticing.
 */
export function useOutboxDrain() {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  useEffect(() => {
    const run = () => void sweep(nostr as Publisher, queryClient);

    run();

    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };

    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(run, SWEEP_INTERVAL);

    return () => {
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [nostr, queryClient]);
}

/** What this account still has waiting, and the controls for it. */
export function useOutbox() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  const all = useSyncExternalStore(
    subscribeOutbox,
    () => readStore(outboxKey),
    () => outboxKey.fallback
  );

  const items: OutboxItem[] = useMemo(
    () => (user ? all.filter((item) => item.event.pubkey === user.pubkey) : []),
    [all, user]
  );

  const retry = useCallback(
    () => sweep(nostr as Publisher, queryClient),
    [nostr, queryClient]
  );

  return { items, count: items.length, retry, discard: dequeue };
}
