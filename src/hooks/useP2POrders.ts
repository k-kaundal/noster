import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { ORDER_KIND, parseOrder, type P2POrder } from '@/lib/nip69';

/**
 * The shared p2p order book.
 *
 * Queried by kind and `z` rather than by platform: pooling the order books is
 * the entire point of the NIP, and filtering to known platforms here would
 * rebuild the fragmentation it exists to undo.
 *
 * Events past their NIP-40 `expiration` never arrive — the pool drops those on
 * the way in — so what is filtered here is the separate `expires_at`, which is
 * about the order lapsing rather than the event being deleted.
 */
export function useP2POrders(limit = 200) {
  const { nostr } = useNostr();

  const query = useQuery<P2POrder[]>({
    queryKey: ['p2p-orders', limit],
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [{ kinds: [ORDER_KIND], '#z': ['order'], limit }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) }
      );

      return latestPerAddress(events);
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  return {
    orders: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/**
 * One revision per order.
 *
 * Addressable, so a platform republishes the same `d` as the order moves from
 * pending to in-progress to success. Relays hold the older revisions and hand
 * several back; showing a superseded one offers a trade somebody already took.
 */
function latestPerAddress(events: NostrEvent[]): P2POrder[] {
  const byAddress = new Map<string, P2POrder>();

  for (const event of events) {
    const order = parseOrder(event);
    if (!order) continue;

    const address = `${event.pubkey}:${order.id}`;
    const existing = byAddress.get(address);

    if (!existing || existing.event.created_at < event.created_at) {
      byAddress.set(address, order);
    }
  }

  return [...byAddress.values()].sort(
    (a, b) => b.event.created_at - a.event.created_at
  );
}
