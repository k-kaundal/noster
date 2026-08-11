import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  HISTORY_KIND,
  parseHistoryEvent,
  type HistoryEntry,
  type Nip44Signer,
} from '@/lib/nip60';

/**
 * The wallet's transaction history, read back from kind 7376.
 *
 * Reconstructed from relays rather than kept locally, which is the point of
 * publishing it: the same history is there after clearing site data, and it is
 * the same history in every NIP-60 client the person uses. Local storage would
 * be faster and would lose exactly the cases worth having a record for.
 *
 * Decryption failures are dropped rather than surfaced. An entry written by a
 * key no longer held, or by a client that sealed it differently, is not an
 * error to report — it is somebody else's record showing up in a query, and a
 * wallet that reported it would be crying wolf on every load.
 */
export function useCashuHistory(limit = 100) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;

  return useQuery<HistoryEntry[]>({
    queryKey: ['cashu-history', pubkey ?? '', limit],
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [{ kinds: [HISTORY_KIND], authors: [pubkey!], limit }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }
      );

      const entries = await Promise.all(
        events
          .sort((a, b) => b.created_at - a.created_at)
          .map((event) => parseHistoryEvent(user!.signer as Nip44Signer, event))
      );

      return entries.filter(
        (entry): entry is HistoryEntry =>
          // A zero-amount entry is a bare redeemed marker, which belongs to
          // nutzap bookkeeping rather than on a list of what the balance did
          !!entry && entry.amount > 0
      );
    },
    enabled: !!pubkey && !user?.readOnly,
    staleTime: 60_000,
  });
}
