import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { recallSync, remember } from '@/lib/eventStore';
import { ZAP_RECEIPT_KIND, explainZapReceipt } from '@/lib/zap';
import { providerKeyForRecipients } from '@/lib/zapProviders';
import {
  dailyEarnings,
  earningFrom,
  summarizeStudio,
  type Earning,
} from '@/lib/studio';

/**
 * Long enough for a slow relay to finish.
 *
 * A receipt query now fans out past the reader's own relays — see
 * `isZapReceiptRequest` — and the extra relays are chosen precisely because
 * they are large, which also makes them slower to scan a `p` tag index. Eight
 * seconds was cutting the widest of them off, and a relay that does not answer
 * in time is indistinguishable from a relay holding nothing.
 */
const TIMEOUT = 12_000;

/** Asked of each relay. Merged and deduplicated after, so overlap is free. */
const RECEIPT_LIMIT = 2000;

/** A memory bound on the durable store, not a display limit. */
const RECEIPT_CAP = 5000;

/**
 * The creator's own figures.
 *
 * Two things make this number trustworthy, and they pull in opposite
 * directions.
 *
 * Every receipt is validated before it counts, with the provider key when this
 * browser knows the author's lightning server. That check matters more here
 * than anywhere: these are the numbers somebody would quote, and an unchecked
 * receipt is a number anybody can write.
 *
 * But a total also has to stop moving. Zap receipts are scattered — a receipt
 * is published by the *sender's* lightning server to the relays the *sender's*
 * client named, so no one relay has them all and which ones answer inside a
 * timeout varies by minute, network and country. Read fresh each time, the
 * total was a measurement of luck: the same account genuinely showed different
 * earnings depending where it was opened from.
 *
 * So receipts are accumulated rather than re-fetched. Every read unions into a
 * durable store keyed on the receipt id, which can only add evidence — a
 * receipt that existed does not stop existing because the relay holding it was
 * slow today. See `lib/eventStore`.
 */
export function useStudio(windowDays: number) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const scope = `earnings:${pubkey ?? ''}`;

  const lud16 = useAuthor(pubkey).data?.metadata?.lud16;

  const query = useQuery({
    queryKey: ['studio', pubkey ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(TIMEOUT)]);

      const received = await nostr
        .query(
          [
            {
              kinds: [ZAP_RECEIPT_KIND],
              '#p': [pubkey!],
              limit: RECEIPT_LIMIT,
            },
          ],
          { signal }
        )
        .catch((error: unknown) => {
          /*
           * A failed read is not the same as no earnings. Anything already
           * accumulated is a better answer than zero, and the only case worth
           * surfacing as an error is having nothing at all to show.
           */
          if (recallSync(scope).length) return null;
          throw error;
        });

      /*
       * The union, not this read. What comes back is merged into everything
       * previously seen and the whole set is returned — so the figure grows as
       * relays are heard from and never shrinks because one was slow.
       */
      return received === null
        ? recallSync(scope)
        : await remember(scope, received, RECEIPT_CAP);
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,

    /** Paints what is already known before the network is asked. */
    initialData: () => {
      const held = pubkey ? recallSync(scope) : [];
      return held.length ? held : undefined;
    },
    initialDataUpdatedAt: 0,
  });

  const providerPubkey = providerKeyForRecipients([pubkey ?? ''], lud16);

  const { earnings, refused } = useMemo(() => {
    const receipts: NostrEvent[] = query.data ?? [];

    const kept: Earning[] = [];
    let refused = 0;

    for (const receipt of receipts) {
      /*
       * No target named, so a zap on a note, an article or the person
       * themselves all count — which is what "earned" means here.
       *
       * Every check applies, the provider key included: this page is where a
       * creator reads the figure they would quote, so it is one of the two
       * places an unverifiable receipt must not count. A note shows it and
       * flags it instead — see `zapSummary`.
       */
      if (
        explainZapReceipt(receipt, {
          recipientPubkey: [pubkey ?? ''],
          providerPubkey,
        }) !== null
      ) {
        refused += 1;
        continue;
      }

      const earning = earningFrom(receipt);
      if (earning) kept.push(earning);
    }

    return { earnings: kept, refused };
  }, [query.data, pubkey, providerPubkey]);

  const summary = useMemo(
    () => summarizeStudio(earnings, windowDays),
    [earnings, windowDays]
  );

  /** One point per day, empty days included. See `lib/studio`. */
  const daily = useMemo(
    () => dailyEarnings(earnings, windowDays),
    [earnings, windowDays]
  );

  return {
    summary,
    daily,
    isLoading: query.isLoading,
    isError: query.isError,
    /**
     * Receipts that named this person and were not counted.
     *
     * Reported rather than swallowed. This page is stricter than a note — a
     * provider mismatch refuses the receipt here instead of flagging it — and
     * a creator comparing the two needs to see where the difference went
     * rather than concluding one of them is broken.
     */
    refused,
    /** Every receipt on hand, counted or not: the denominator. */
    received: query.data?.length ?? 0,
    /** Whether the totals are checked against the author's own server. */
    verified: !!providerPubkey,
  };
}
