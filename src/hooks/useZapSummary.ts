import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { useNoteStats } from '@/hooks/useNoteStats';
import { parseZapSplits } from '@/lib/zapSplit';
import { providerKeyForRecipients } from '@/lib/zapProviders';
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
 * The provider key is never *fetched* here, and that constraint has not
 * changed: checking it that way means an LNURL request per visible post to a
 * third party who then knows what the reader is reading. It is instead read
 * from the table `lib/zapProviders` fills from requests the app already makes,
 * which costs nothing and leaks nothing. A server nobody here has paid stays
 * unknown, and its receipts are judged as before — see `summarizeZaps` for the
 * checks that never need the network.
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

  /**
   * The author's lightning address, which names the server whose key signs
   * their receipts. Already loaded for the avatar and name beside the post, so
   * reading it here adds no request.
   */
  const lud16 = useAuthor(event?.pubkey).data?.metadata?.lud16;

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
      providerPubkey: providerKeyForRecipients(recipientPubkey, lud16),
    });
  }, [zaps, event, address, lud16]);

  return { ...summary, isLoading };
}

function isAddressable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}
