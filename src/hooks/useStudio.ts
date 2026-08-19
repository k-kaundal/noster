import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { ZAP_RECEIPT_KIND, explainZapReceipt } from '@/lib/zap';
import { providerKeyForRecipients } from '@/lib/zapProviders';
import {
  EMPTY_SUMMARY,
  dailyEarnings,
  earningFrom,
  summarizeStudio,
  type Earning,
} from '@/lib/studio';

const TIMEOUT = 8000;

/** Enough to cover two windows of the longest period offered. */
const RECEIPT_LIMIT = 2000;

/**
 * The creator's own figures.
 *
 * Every receipt is validated before it counts, with the provider key when this
 * browser knows the author's lightning server. That check matters more here
 * than anywhere: these are the numbers somebody would quote, and an unchecked
 * receipt is a number anybody can write.
 */
export function useStudio(windowDays: number) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;

  const lud16 = useAuthor(pubkey).data?.metadata?.lud16;

  const query = useQuery({
    queryKey: ['studio', pubkey ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(TIMEOUT)]);

      const receipts = await nostr.query(
        [
          {
            kinds: [ZAP_RECEIPT_KIND],
            '#p': [pubkey!],
            limit: RECEIPT_LIMIT,
          },
        ],
        { signal }
      );

      const providerPubkey = providerKeyForRecipients([pubkey!], lud16);

      return receipts
        .filter(
          (receipt) =>
            /*
             * No target named, so a zap on a note, an article or the person
             * themselves all count — which is what "earned" means here.
             *
             * Every check applies, the provider key included: this page is
             * where a creator reads the figure they would quote, so it is one
             * of the two places an unverifiable receipt must not count. A note
             * shows it and flags it instead — see `zapSummary`.
             */
            explainZapReceipt(receipt, {
              recipientPubkey: [pubkey!],
              providerPubkey,
            }) === null
        )
        .map(earningFrom)
        .filter((earning): earning is Earning => !!earning);
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
  });

  const summary = useMemo(
    () => (query.data ? summarizeStudio(query.data, windowDays) : EMPTY_SUMMARY),
    [query.data, windowDays]
  );

  /** One point per day, empty days included. See `lib/studio`. */
  const daily = useMemo(
    () => dailyEarnings(query.data ?? [], windowDays),
    [query.data, windowDays]
  );

  return {
    summary,
    daily,
    isLoading: query.isLoading,
    isError: query.isError,
    /** Whether the totals are checked against the author's own server. */
    verified: !!providerKeyForRecipients([pubkey ?? ''], lud16),
  };
}
