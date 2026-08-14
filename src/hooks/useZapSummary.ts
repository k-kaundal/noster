import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNoteStats } from '@/hooks/useNoteStats';
import { parseZapSplits } from '@/lib/zapSplit';
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
  /**
   * An addressable event is referenced by coordinate, never by id.
   *
   * An article's zaps carry `a` = `30023:<pubkey>:<d>` and frequently no `e`
   * tag at all, so asking for its id finds nothing — which is why articles
   * showed no total however many times they had been paid.
   */
  const address = event && isAddressable(event.kind)
    ? `${event.kind}:${event.pubkey}:${
        event.tags.find(([name]) => name === 'd')?.[1] ?? ''
      }`
    : undefined;

  const { zaps, isLoading } = useNoteStats(address ?? event?.id);

  const summary = useMemo(() => {
    if (!event) return EMPTY_ZAP_SUMMARY;

    /**
     * The author, and anyone the note routes its zaps to instead.
     *
     * NIP-57 Appendix G: a `zap` tag redirects payment away from the author,
     * and the receipt then names the recipient it was actually paid to. This
     * checked against the author alone, so a note with a zap split — the one
     * kind of note where the author deliberately gave the money away — showed
     * nothing at all, however much it earned.
     */
    const recipientPubkey = [
      event.pubkey,
      ...parseZapSplits(event).map((share) => share.pubkey),
    ];

    return summarizeZaps(zaps, {
      eventId: address ? undefined : event.id,
      address,
      recipientPubkey,
    });
  }, [zaps, event, address]);

  return { ...summary, isLoading };
}

function isAddressable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}
