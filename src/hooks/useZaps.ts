import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useNoteStats } from '@/hooks/useNoteStats';
import { summarizeZaps } from '@/lib/zapSummary';
import { ZAP_RECEIPT_KIND } from '@/lib/zap';
import { useAppContext } from '@/hooks/useAppContext';
import { useToast } from '@/hooks/useToast';
import { nip57 } from 'nostr-tools';
import type { Event } from 'nostr-tools';
import { useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { readRelays } from '@/lib/relay';
import { parseZapSplits, splitAmount } from '@/lib/zapSplit';
import { GOAL_KIND, linkedGoal, parseZapGoal } from '@/lib/nip75';
import { describeSignerError } from '@/lib/signerErrors';
import { clearSignerFailure, recordSignerFailure } from '@/lib/signerStatus';
import {
  fetchInvoice,
  fetchPayMetadata,
  readLnurlJson,
  validateAmount,
} from '@/lib/lnurlPay';
import {
  addressPointerFor,
  buildZapRequest,
  describeZapTarget,
  lightningAddressUrl,
  lnurlEncode,
  zapCallbackUrl,
} from '@/lib/zapRequest';

/** An invoice waiting to be paid, and what paying it will produce. */
export interface ZapInvoice {
  bolt11: string;
  amountSats: number;
  /**
   * Whether the recipient's server publishes a NIP-57 receipt. Without one the
   * money arrives but the zap appears nowhere, which is worth saying out loud.
   */
  publishesReceipt: boolean;
}

export function useZaps(target: Event | Event[], onZapSuccess?: () => void) {
  const { nostr } = useNostr();
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const queryClient = useQueryClient();

  const actualTarget = Array.isArray(target) ? (target.length > 0 ? target[0] : null) : target;

  const author = useAuthor(actualTarget?.pubkey);
  const [isZapping, setIsZapping] = useState(false);
  const [invoice, setInvoice] = useState<string | null>(null);

  const defaultRelays = [
    'wss://relay.primal.net',
    'wss://relay.damus.io',
    'wss://nostr.wine',
  ];

  /**
   * The receipts, from the batched stats query every visible note already
   * shares.
   *
   * This used to be a query of its own, which meant an article page issued
   * two requests for exactly the same receipts — one from the zap control and
   * one from the total beside it — and, worse, added them up with two
   * different rules. `useZaps` read the receipt's own `amount` tag first
   * while `summarizeZaps` reads the invoice, so the same note could show two
   * different totals in two places on the same screen. There is one fetch and
   * one calculation now.
   */
  const address =
    actualTarget && actualTarget.kind >= 30000 && actualTarget.kind < 40000
      ? `${actualTarget.kind}:${actualTarget.pubkey}:${
          actualTarget.tags.find((t) => t[0] === 'd')?.[1] || ''
        }`
      : undefined;

  const statsKey = address ?? actualTarget?.id;
  const { zaps: zapEvents, isLoading: isLoadingZaps } = useNoteStats(statsKey);

  /** Pending post-payment refetches, so they can be cancelled on unmount. */
  const refreshTimers = useRef<number[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    const timers = refreshTimers.current;

    return () => {
      setIsZapping(false);
      setInvoice(null);
      timers.forEach(window.clearTimeout);
    };
  }, []);

  // Poll for zap receipt when invoice is generated
  useEffect(() => {
    if (!invoice || !actualTarget) return;

    const POLL_INTERVAL = 5000; // Poll every 5 seconds
    const TIMEOUT = 300000; // Stop polling after 5 minutes

    const pollForZapReceipt = async () => {
      try {
        const signal = AbortSignal.timeout(5000);

        /*
         * By coordinate for an addressable event, by id for everything else.
         * Our own request tags an article with `a` and no `e` at all, so this
         * asked for a tag the receipt does not carry — the poll could never
         * match, and zapping an article never refreshed its total however long
         * anyone waited.
         */
        const events = await nostr.query(
          [
            {
              kinds: [ZAP_RECEIPT_KIND],
              ...(address ? { '#a': [address] } : { '#e': [actualTarget.id] }),
              since: Math.floor(Date.now() / 1000) - 60,
            },
          ],
          { signal }
        );
        if (events.length > 0) {
          const latestZap = events.find(zap => zap.tags.some(tag => tag[0] === 'bolt11' && tag[1] === invoice));
          if (latestZap) {
            setInvoice(null);
            setIsZapping(false);
            toast({
              title: 'Zap successful!',
              description: `Your ${nip57.getSatoshisAmountFromBolt11(invoice)} sat zap was received!`,
            });
            /*
             * The receipts live in the shared stats cache now, so that is
             * what has to be refreshed — invalidating the old private key
             * would refetch nothing and leave the total a payment behind.
             */
            queryClient.invalidateQueries({
              queryKey: ['note-stats', statsKey ?? ''],
              exact: true,
            });
            queryClient.refetchQueries({
              queryKey: ['note-stats', statsKey ?? ''],
              exact: true,
            });

            /*
             * Goals keep their own tally, on its own key, and nothing was
             * refreshing it — so funding a goal left the bar exactly where it
             * was and the zap looked like it had gone nowhere. Every goal
             * rather than one: the zap may have named the goal itself, or a
             * note announcing it, and both are counted by whichever card is
             * on screen.
             */
            queryClient.invalidateQueries({ queryKey: ['zap-goal'] });

            onZapSuccess?.();
            return true;
          }
        }
        return false;
      } catch (error) {
        console.error('Error polling zap receipt:', error);
        return false;
      }
    };

    const pollIntervalId = setInterval(async () => {
      const paymentDetected = await pollForZapReceipt();
      if (paymentDetected) {
        clearInterval(pollIntervalId);
        clearTimeout(timeoutId);
      }
    }, POLL_INTERVAL);

    const timeoutId = setTimeout(() => {
      clearInterval(pollIntervalId);
      if (invoice) {
        toast({
          title: 'Zap timeout',
          description: 'No payment detected within 5 minutes. Please try again.',
          variant: 'destructive',
        });
        setInvoice(null);
        setIsZapping(false);
      }
    }, TIMEOUT);

    return () => {
      clearInterval(pollIntervalId);
      clearTimeout(timeoutId);
    };
  }, [invoice, actualTarget, address, nostr, queryClient, toast, onZapSuccess, statsKey]);


  const { zapCount, totalSats, zaps } = useMemo(() => {
    if (!actualTarget) {
      return { zapCount: 0, totalSats: 0, zaps: [] as NostrEvent[] };
    }

    /**
     * NIP-57 Appendix F, applied in one place.
     *
     * Every kind 9735 with a matching `#e` used to be counted, so anybody
     * could publish a receipt naming any note and any amount and inflate the
     * number readers judge a post by. `summarizeZaps` does the checking and
     * the arithmetic, and it is the same function the totals in the feed use
     * — so a note cannot report one figure here and another there.
     */
    /*
     * The author plus any Appendix G split recipient, matching
     * `useZapSummary` — a note that routes its zaps elsewhere is paid to
     * somebody the receipt names instead of the author, and checking only the
     * author reported zero for exactly those notes.
     */
    const summary = summarizeZaps(zapEvents, {
      eventId: address ? undefined : actualTarget.id,
      address,
      recipientPubkey: [
        actualTarget.pubkey,
        ...parseZapSplits(actualTarget).map((share) => share.pubkey),
      ],
    });

    const counted = new Set(summary.zappers.map((zapper) => zapper.receiptId));

    return {
      zapCount: summary.count,
      totalSats: summary.totalSats,
      // The receipts that survived, for callers that want the events
      zaps: zapEvents.filter((event) => counted.has(event.id)),
    };
  }, [zapEvents, actualTarget, address]);

  /**
   * Turns an amount into an invoice the caller can pay with any wallet.
   *
   * The two LNURL steps and the NIP-57 request are done here; paying is not.
   * The library that used to do all three insisted on `window.webln`, which
   * made a browser extension the only way to zap anything — the custodial
   * wallet this app hands out and any connected NWC wallet were both ignored,
   * and the failure read as "no wallet available" rather than "install Alby".
   */
  const requestInvoice = async (
    amount: number,
    comment: string,
    /**
     * Who to pay, when it is not the event's author.
     *
     * A NIP-57 Appendix G `zap` tag routes an event's zaps to somebody else,
     * and the amount is split between them. Passing the recipient in keeps one
     * invoice path for both cases rather than a second one that would drift.
     */
    override?: { pubkey: string; metadata?: NostrMetadata; event?: NostrEvent }
  ): Promise<ZapInvoice | null> => {
    if (amount <= 0) return null;

    if (!user) {
      toast({
        title: 'Log in to zap',
        description: 'A zap is signed by you, so it needs your key.',
        variant: 'destructive',
      });
      return null;
    }

    if (!actualTarget) return null;

    const payeePubkey = override?.pubkey ?? actualTarget.pubkey;

    let payeeEvent = override ? override.event : author.data?.event;
    let metadata = override ? override.metadata : author.data?.metadata;

    /**
     * A split recipient is named by pubkey alone, so their profile has to be
     * fetched before there is a lightning address to resolve. Only when it was
     * not supplied — the ordinary path already has it in hand.
     */
    if (!metadata && override) {
      const [profile] = await nostr.query(
        [{ kinds: [0], authors: [payeePubkey], limit: 1 }],
        { signal: AbortSignal.timeout(5000) }
      );

      if (profile) {
        payeeEvent = profile;
        try {
          metadata = JSON.parse(profile.content) as NostrMetadata;
        } catch {
          // An unreadable profile falls through to the message below
        }
      }
    }

    if (!metadata) {
      toast({
        title: "Couldn't read their profile",
        description: 'Try again in a moment.',
        variant: 'destructive',
      });
      return null;
    }

    const problem = describeZapTarget(metadata);
    if (problem) {
      toast({ title: "Can't zap this one", description: problem, variant: 'destructive' });
      return null;
    }

    setIsZapping(true);

    try {
      /**
       * An `lud16` resolves to a well-known URL with no network call; an
       * `lud06` is a bech32 LNURL that has to be decoded, which nostr-tools
       * already does. The common case stays local either way.
       */
      const endpoint = metadata.lud16
        ? lightningAddressUrl(metadata.lud16)
        : payeeEvent
          ? await nip57.getZapEndpoint(payeeEvent as Event)
          : null;

      if (!endpoint) throw new Error('Their lightning address did not resolve.');

      const payMetadata = await fetchPayMetadata(
        endpoint,
        AbortSignal.timeout(10000)
      );

      const amountMsat = amount * 1000;
      const invalid = validateAmount(amount, payMetadata);
      if (invalid) throw new Error(invalid);

      const relays = [
        ...(config.relayUrl ? [config.relayUrl] : []),
        ...readRelays(config.relays),
        ...defaultRelays,
      ];

      /**
       * NIP-75: a goal names the relays its tally is read from, and a zap
       * that does not publish its receipt there is money that leaves a wallet
       * and never appears on the progress bar. Required rather than appended,
       * so the relay cap cannot drop them.
       */
      const goal = parseZapGoal(actualTarget);

      /**
       * A goal the target merely links to, rather than being. Fetched because
       * its `relays` tag is a MUST and the `goal` tag only carries a hint —
       * one query, against the hint when there is one, so a zap toward an
       * article's goal lands where that goal is counted.
       */
      const link = goal ? null : linkedGoal(actualTarget);
      let linkedRelays: string[] = [];

      if (link) {
        const find = (source: { query: typeof nostr.query }) =>
          source
            .query([{ ids: [link.id], kinds: [GOAL_KIND], limit: 1 }], {
              signal: AbortSignal.timeout(4000),
            })
            .catch(() => [] as NostrEvent[]);

        /*
         * The hint and the reader's own relays, not one or the other. Naming
         * the goal's relays is a MUST, and a hint that happened to be down
         * used to mean the zap went out without them — money that leaves a
         * wallet and lands where the goal's tally will never look. Both are
         * asked, so it takes two failures rather than one to lose them.
         */
        const [hinted, own] = await Promise.all([
          link.relay ? find(nostr.group([link.relay])) : Promise.resolve([]),
          find(nostr),
        ]);

        const event = hinted[0] ?? own[0];
        linkedRelays = event ? (parseZapGoal(event)?.relays ?? []) : [];
      }

      /**
       * A server that does not advertise `allowsNostr` will take the payment
       * and publish no receipt, so the zap is real money that shows up nowhere.
       * Worth paying anyway — the author still gets it — but worth saying.
       */
      let bolt11: string;

      /*
       * NIP-57 recommends this on the request and on the callback, and has
       * receivers check the two agree. Encoded from the endpoint we actually
       * resolved, so it says what was really asked rather than what a profile
       * claims.
       */
      const lnurl = lnurlEncode(endpoint) ?? undefined;

      if (payMetadata.zapCapable) {
        const request = buildZapRequest({
          recipientPubkey: payeePubkey,
          amountMsat,
          lnurl,
          relays,
          requiredRelays: goal?.relays ?? linkedRelays,
          comment,
          /**
           * A profile zap carries neither `e` nor `a`. NIP-57 attaches the
           * receipt to a note when there is one, and zapping somebody's kind 0
           * is zapping the person — tagging their metadata event would file
           * the receipt against a document nobody reads instead of against
           * them.
           */
          eventId:
            actualTarget.kind === 0 || addressPointerFor(actualTarget)
              ? undefined
              : actualTarget.id,
          addressPointer: addressPointerFor(actualTarget) ?? undefined,
          targetKind: actualTarget.kind === 0 ? undefined : actualTarget.kind,
          goalEventId: link?.id,
        });

        /**
         * The same treatment publishing gets: a zap request is a signature
         * like any other, and a dead remote signer fails here exactly as it
         * does there — with a message about aborting that explains nothing.
         */
        let signed: NostrEvent;
        try {
          signed = await user.signer.signEvent(request);
          clearSignerFailure(user.pubkey);
        } catch (error) {
          const problem = describeSignerError(error, { method: user.method });
          recordSignerFailure(user.pubkey, problem.kind);
          throw new Error(`${problem.title}. ${problem.description}`);
        }

        const response = await fetch(
          zapCallbackUrl(payMetadata.callback, amountMsat, signed, lnurl),
          { signal: AbortSignal.timeout(15000) }
        );

        /*
         * Read the same way the plain LNURL path reads it. This branch called
         * `.json()` on the raw response, so a recipient's server answering
         * with an HTML error page — the ordinary shape of a proxy that has no
         * rule for the name — surfaced as `Unexpected token '<'` after the
         * person had already been asked to sign the request.
         */
        const body = await readLnurlJson(response, 'invoice');

        const returned = (body as Record<string, unknown>)?.pr;
        if (typeof returned !== 'string' || !returned) {
          throw new Error("Their server didn't return an invoice.");
        }
        bolt11 = returned;
      } else {
        bolt11 = await fetchInvoice(
          payMetadata,
          amountMsat,
          comment,
          AbortSignal.timeout(15000)
        );
      }

      setInvoice(bolt11);
      setIsZapping(false);

      return {
        bolt11,
        amountSats: amount,
        publishesReceipt: payMetadata.zapCapable,
      };
    } catch (error) {
      setIsZapping(false);
      toast({
        title: 'Could not prepare the zap',
        description: (error as Error).message,
        variant: 'destructive',
      });
      return null;
    }
  };

  /** Called once a wallet reports the invoice paid. */
  const confirmPaid = useCallback(() => {
    if (!actualTarget) return;

    setInvoice(null);
    setIsZapping(false);

    const refresh = () => {
      queryClient.invalidateQueries({
        queryKey: ['note-stats', statsKey ?? ''],
        exact: true,
      });

      /**
       * Every goal tally, not one keyed by this event.
       *
       * `exact` against `['zap-goal', id]` matched nothing: the key carries a
       * third segment for the announcing event, so the one invalidation meant
       * to move the progress bar after a payment quietly matched no query at
       * all. A prefix match costs a refetch of any goal on screen, which is at
       * most a handful, and it catches the case that actually matters — a zap
       * on a note that funds a goal, where the goal is keyed by neither of the
       * ids involved in this payment.
       */
      queryClient.invalidateQueries({ queryKey: ['zap-goal'] });
    };

    /**
     * Checked repeatedly, because the receipt is not ours to write.
     *
     * The recipient's lightning server publishes it once the invoice settles,
     * and then it has to reach a relay we read. That is seconds away at best,
     * so asking at the moment of payment asks for an event that does not exist
     * yet and finds the same zero — and this is also where the polling that
     * would have caught it stops, since confirming payment clears the invoice.
     *
     * Spread out rather than hammered: a receipt that has not appeared in
     * half a minute is usually one that never will, and by then the ordinary
     * staleness rules take over.
     */
    refresh();

    for (const delay of [3000, 8000, 15000, 30000]) {
      // Tracked so navigating away cancels them rather than refetching into
      // an unmounted screen
      refreshTimers.current.push(window.setTimeout(refresh, delay));
    }

    onZapSuccess?.();
  }, [actualTarget, queryClient, onZapSuccess, statsKey]);

  const resetInvoice = useCallback(() => {
    setInvoice(null);
  }, []);

  /**
   * Where this event says its zaps should go.
   *
   * Empty for the ordinary case, where the author is the recipient. When it is
   * not empty the author is not the destination at all — NIP-57 Appendix G —
   * and paying them would be paying the wrong person.
   */
  const splits = useMemo(
    () => (actualTarget ? parseZapSplits(actualTarget) : []),
    [actualTarget]
  );

  /**
   * How an amount divides across the split, in millisats.
   *
   * Exposed rather than applied here because paying it is several invoices,
   * one per recipient, and the caller is what knows how to pay.
   */
  const resolveSplit = useCallback(
    (amountSats: number) => splitAmount(splits, amountSats * 1000),
    [splits]
  );

  return {
    splits,
    hasSplit: splits.length > 0,
    resolveSplit,
    zaps,
    zapCount,
    totalSats,
    isLoading: isLoadingZaps,
    requestInvoice,
    confirmPaid,
    isZapping,
    invoice,
    resetInvoice,
  };
}