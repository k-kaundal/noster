import { NRelay1, type NostrEvent, type NostrFilter } from '@nostrify/nostrify';

/**
 * A direct connection to one relay, for NIP-29 groups.
 *
 * Everything else in this app reads through the pool, which fans a filter out
 * to every read relay and merges the answers. That is right for a feed and
 * wrong for a group: NIP-29 says the same id on two relays can be two
 * different communities with different admins and different history, and the
 * spec treats that as a feature rather than a conflict. Merging them would
 * splice two conversations into one and let a message from a fork appear as
 * though it had been said here.
 *
 * So a group is always read from, and written to, exactly the relay that
 * hosts it.
 */

/** Live connections, one per relay, kept for as long as the tab is open. */
const connections = new Map<string, NRelay1>();

function connect(url: string): NRelay1 {
  const existing = connections.get(url);
  if (existing) return existing;

  const relay = new NRelay1(url, {
    reconnectTimeout: 5000,
    maxReconnectTime: 60000,
    requestTimeout: 5000,
  });

  connections.set(url, relay);
  return relay;
}

/** Reads from one relay, with no other relay's answers mixed in. */
export async function queryGroupRelay(
  url: string,
  filters: NostrFilter[],
  signal?: AbortSignal
): Promise<NostrEvent[]> {
  return await connect(url).query(filters, { signal });
}

/**
 * Publishes to one relay.
 *
 * Deliberately not the write-relay set. A group event carries an `h` tag and
 * timeline references that only mean anything on its own relay — everywhere
 * else it is an unroutable message naming a group that does not exist there,
 * and the spec asks relays to reject exactly that.
 */
export async function publishToGroupRelay(
  url: string,
  event: NostrEvent,
  signal?: AbortSignal
): Promise<void> {
  await connect(url).event(event, { signal });
}

/** Drops a connection, e.g. when a relay is removed from the saved list. */
export function closeGroupRelay(url: string): void {
  const relay = connections.get(url);
  if (!relay) return;

  connections.delete(url);
  void relay.close();
}
