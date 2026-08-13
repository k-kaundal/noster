import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNoteStats } from '@/hooks/useNoteStats';
import {
  EMPTY_ZAP_SUMMARY,
  summarizeZaps,
  type ZapSummary,
} from '@/lib/zapSummary';

/**
 * What a note earned, from the receipts already on hand.
 *
 * Costs nothing extra. `useNoteStats` has been fetching kind 9735 alongside
 * replies, reposts and reactions in one batched query per screenful all along
 * — the zaps came back and were dropped on the floor, which is why the zap
 * button was the only one in the row with no number on it.
 *
 * The provider key is deliberately not fetched here. Checking it means an
 * LNURL request to the author's lightning server per note, which on a feed is
 * a request per visible post to a third party that then knows what the reader
 * is looking at. Every other NIP-57 check is applied; see `summarizeZaps`.
 */
export function useZapSummary(event: NostrEvent | undefined): ZapSummary & {
  isLoading: boolean;
} {
  const { zaps, isLoading } = useNoteStats(event?.id);

  const summary = useMemo(() => {
    if (!event) return EMPTY_ZAP_SUMMARY;

    return summarizeZaps(zaps, {
      eventId: event.id,
      recipientPubkey: event.pubkey,
    });
  }, [zaps, event]);

  return { ...summary, isLoading };
}
