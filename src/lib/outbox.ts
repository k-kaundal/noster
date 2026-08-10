import type { NostrEvent } from '@nostrify/nostrify';
import { defineKey, readStore, subscribeStore, writeStore } from '@/lib/store';

/**
 * Notes that were written but never reached a relay.
 *
 * Publishing on Nostr fails in ways that have nothing to do with the person
 * doing it — a train tunnel, a relay restarting, a laptop lid closed mid-send.
 * Losing what they wrote to any of those is indefensible, and asking them to
 * write it again is worse than useless because they no longer have it.
 *
 * What is queued here is already signed, which is the important part: sending
 * it later needs no key, no extension prompt and no user present. The event is
 * finished; only delivery is outstanding.
 */
export interface OutboxItem {
  event: NostrEvent;
  queuedAt: number;
  attempts: number;
  /** Why the last attempt failed, for a person deciding whether to retry. */
  lastError?: string;
}

/** Enough for a bad afternoon. Past this the oldest are dropped. */
const MAX_ITEMS = 50;

/** After a week an unsent note is unlikely to still be wanted. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const outboxKey = defineKey<OutboxItem[]>('nostr:outbox', []);

function prune(items: OutboxItem[], now: number): OutboxItem[] {
  return items
    .filter((item) => now - item.queuedAt < MAX_AGE_MS)
    .slice(-MAX_ITEMS);
}

export function readOutbox(): OutboxItem[] {
  return readStore(outboxKey);
}

export function subscribeOutbox(listener: () => void): () => void {
  // The store's own subscription, so the indicator in the header updates from
  // wherever the publish happened
  return subscribeStore(outboxKey.name, listener);
}

/** Adds an event to the queue, or refreshes the one already there. */
export function enqueue(event: NostrEvent, error?: Error): void {
  const now = Date.now();

  writeStore(outboxKey, (items) => {
    const existing = items.find((item) => item.event.id === event.id);

    const next = existing
      ? items.map((item) =>
          item.event.id === event.id
            ? {
                ...item,
                attempts: item.attempts + 1,
                lastError: error?.message,
              }
            : item
        )
      : [
          ...items,
          { event, queuedAt: now, attempts: 1, lastError: error?.message },
        ];

    return prune(next, now);
  });
}

export function dequeue(eventId: string): void {
  writeStore(outboxKey, (items) =>
    items.filter((item) => item.event.id !== eventId)
  );
}

export function clearOutbox(): void {
  writeStore(outboxKey, []);
}

/** Only this identity's unsent notes. Another account's are not theirs to see. */
export function outboxFor(pubkey: string | undefined): OutboxItem[] {
  if (!pubkey) return [];
  return readOutbox().filter((item) => item.event.pubkey === pubkey);
}

export { outboxKey };
