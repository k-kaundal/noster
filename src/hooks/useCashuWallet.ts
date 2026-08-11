import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateSecretKey } from 'nostr-tools';
import { bytesToHex } from 'nostr-tools/utils';
import type { MintQuoteBolt11Response, Proof } from '@cashu/cashu-ts';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  CASHU_MINT_URL,
  consumedProofs,
  dropSpentProofs,
  encodeToken,
  foldConcurrentChanges,
  loadWallet,
  mergeProofs,
  mintHost,
  proofsToSats,
  withoutProofs,
} from '@/lib/cashu';
import {
  addQuote,
  addUsedSecrets,
  readProofs,
  readQuotes,
  readUsedSecrets,
  removeQuote,
  rememberWalletPrivkey,
  walletPrivkey,
  writeProofs,
  type PendingQuote,
} from '@/lib/cashuStore';
import {
  TOKEN_KIND,
  WALLET_KIND,
  buildTokenContent,
  buildWalletContent,
  currentTokenEvents,
  parseTokenEvent,
  parseWalletEvent,
  type Nip44Signer,
} from '@/lib/nip60';

interface EcashState {
  proofs: Proof[];
  /** Token events currently holding this balance, to be superseded on change. */
  eventIds: string[];
}

const EMPTY: EcashState = { proofs: [], eventIds: [] };

/**
 * The signed-in user's ecash at our mint.
 *
 * Ecash is held, not owed: the proofs in this hook are the money itself, so
 * every operation writes them to storage before anything else and mirrors them
 * to relays straight after. The mint knows a proof was issued and later spent,
 * but not that the same person did both.
 */
export function useCashuWallet(mintUrl: string = CASHU_MINT_URL) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Browsing somebody else's timeline with only their npub.
   *
   * Ecash cannot work here and should not pretend to. The backup is encrypted
   * to the holder's own key, so a read-only session can neither decrypt what
   * is on the relays nor write a new copy — every operation would succeed at
   * the mint, because proofs are bearer tokens and need no signature, and then
   * fail to record itself anywhere. That is the shape of a wallet that loses
   * money quietly.
   */
  const readOnly = !!user?.readOnly;
  const pubkey = readOnly ? undefined : user?.pubkey;

  const queryKey = useMemo(
    () => ['cashu-proofs', pubkey ?? '', mintUrl],
    [pubkey, mintUrl]
  );

  /**
   * Everything this identity has at this mint, from every copy of it.
   *
   * Three sources disagree by design: local storage is fastest but device
   * bound, relays hold backups this browser has never seen, and only the mint
   * knows what has actually been spent. The answer is the union of the first
   * two, minus what the third says is gone.
   */
  const state = useQuery<EcashState>({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!user || !pubkey || readOnly) return EMPTY;

      const local = readProofs(pubkey, mintUrl);
      let remote: Proof[] = [];
      let eventIds: string[] = [];

      try {
        const events = await nostr.query(
          [{ kinds: [TOKEN_KIND], authors: [pubkey], limit: 100 }],
          { signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) }
        );

        // Newest first, because decrypting costs a round trip to the signer
        // and the latest events are the ones that supersede the rest
        const ordered = [...events].sort(
          (a, b) => b.created_at - a.created_at
        );

        const records = (
          await Promise.all(
            ordered.map((event) =>
              parseTokenEvent(user.signer as Nip44Signer, event)
            )
          )
        ).filter(
          (record): record is NonNullable<typeof record> =>
            !!record && record.mint === mintUrl
        );

        const live = currentTokenEvents(records);
        remote = mergeProofs(...live.map((record) => record.proofs));
        eventIds = live.map((record) => record.event.id);
      } catch {
        // No relay reachable, or a signer that declined to decrypt. Local
        // storage still holds the balance; the backup can wait.
      }

      const used = readUsedSecrets(pubkey, mintUrl);
      const claimed = withoutProofs(mergeProofs(local, remote), used);
      const checked = await dropSpentProofs(claimed, mintUrl);

      /**
       * Everything above describes the wallet as it was when this read
       * started, and the read is slow enough — a relay query, a decrypt per
       * backup, then a round trip to the mint — for a deposit to land inside
       * it. Writing the result as computed would erase those proofs: money in,
       * balance down. Re-reading here folds them back in.
       */
      const proofs = foldConcurrentChanges(
        checked,
        local,
        readProofs(pubkey, mintUrl),
        readUsedSecrets(pubkey, mintUrl)
      );

      writeProofs(pubkey, mintUrl, proofs);

      /**
       * Union rather than replacement, for the same reason. These name the
       * events the next backup supersedes, and a commit that happened while
       * this ran has an id this fetch never saw. Naming an already-superseded
       * event costs nothing; missing a live one leaves a backup on the relays
       * whose proofs get counted again on the next device.
       */
      const cached = queryClient.getQueryData<EcashState>(queryKey)?.eventIds;

      return {
        proofs,
        eventIds: [...new Set([...eventIds, ...(cached ?? [])])],
      };
    },
    enabled: !!user && !readOnly,
    staleTime: 30 * 1000,
    retry: false,
  });

  const proofs = state.data?.proofs ?? [];
  const balanceSats = proofsToSats(proofs);

  /**
   * The freshest proof set, read past any stale render.
   *
   * Falls back to storage rather than to nothing. Every mutation builds the
   * new balance on top of what this returns, so an empty answer does not mean
   * "add to nothing" — it writes a balance consisting only of what just
   * happened, and `writeProofs` then overwrites the rest away. Depositing
   * before the balance query had settled was enough to trigger it: the cache
   * is cold for the first few seconds of every visit, and that is exactly when
   * someone opens the wallet and adds money.
   */
  const currentProofs = useCallback(() => {
    const cached = queryClient.getQueryData<EcashState>(queryKey)?.proofs;
    if (cached?.length) return cached;

    return pubkey ? readProofs(pubkey, mintUrl) : [];
  }, [queryClient, queryKey, pubkey, mintUrl]);

  /**
   * Writes the new balance everywhere it has to go.
   *
   * Local first and unconditionally: it is the copy the next click reads, and
   * a relay that is slow or down must not be able to lose a proof. The backup
   * is then rolled forward — one event holding the whole balance, naming the
   * events it replaces — and its failure is reported without undoing anything.
   */
  const commit = useCallback(
    async (next: Proof[], spent: Proof[]) => {
      if (!user || !pubkey || readOnly) {
        throw new Error(
          'Log in with your own key to hold ecash. This session can only read.'
        );
      }

      writeProofs(pubkey, mintUrl, next);
      addUsedSecrets(
        pubkey,
        mintUrl,
        spent.map((proof) => proof.secret)
      );

      const previous =
        queryClient.getQueryData<EcashState>(queryKey)?.eventIds ?? [];

      queryClient.setQueryData<EcashState>(queryKey, {
        proofs: next,
        eventIds: previous,
      });

      try {
        const content = await buildTokenContent(
          user.signer as Nip44Signer,
          pubkey,
          mintUrl,
          next,
          previous
        );

        const event = await publishEvent({
          kind: TOKEN_KIND,
          content,
          tags: [],
        });

        // Ask relays to drop what this replaces. Advisory — `del` above is
        // what actually protects readers from counting a spent proof.
        if (previous.length) {
          await publishEvent({
            kind: 5,
            content: 'superseded',
            tags: [
              ...previous.map((id) => ['e', id]),
              ['k', String(TOKEN_KIND)],
            ],
          }).catch(() => undefined);
        }

        queryClient.setQueryData<EcashState>(queryKey, {
          proofs: next,
          eventIds: [event.id],
        });
      } catch {
        toast({
          title: 'Backup failed',
          description:
            'Your ecash is safe on this device, but it could not be saved to your relays.',
          variant: 'destructive',
        });
      }
    },
    [user, pubkey, readOnly, mintUrl, queryClient, publishEvent, toast, queryKey]
  );

  /**
   * Publishes the wallet event other NIP-60 clients look for.
   *
   * It names the mint and carries a key that nutzaps can be locked to. Written
   * once, when the first deposit is requested, so someone who only browses
   * never has an unexplained event on their profile.
   */
  const ensureWalletEvent = useCallback(async () => {
    if (!user || !pubkey || readOnly) return;

    try {
      const existing = await nostr.query(
        [{ kinds: [WALLET_KIND], authors: [pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(4000) }
      );

      if (existing.length) {
        /**
         * Adopt the key that is already published rather than leaving a
         * different one in storage to be republished later — the two would
         * fight, and each round would orphan whatever was locked to the loser.
         */
        const record = await parseWalletEvent(
          user.signer as Nip44Signer,
          existing[0]
        );

        if (record?.privkey) {
          rememberWalletPrivkey(pubkey, mintUrl, record.privkey);
        }

        return;
      }

      /**
       * Generated once per identity and kept, so this is safe to reach twice.
       * The wallet event is replaceable and an empty query result is not proof
       * that no wallet exists — one slow relay is enough — so a fresh key here
       * would retire the published one and orphan any nutzap locked to it.
       */
      const privkey = walletPrivkey(pubkey, mintUrl, () =>
        bytesToHex(generateSecretKey())
      );

      const content = await buildWalletContent(
        user.signer as Nip44Signer,
        pubkey,
        { mints: [mintUrl], privkey }
      );

      await publishEvent({ kind: WALLET_KIND, content, tags: [] });
    } catch {
      // Nice to have, not required to hold ecash
    }
  }, [user, pubkey, readOnly, mintUrl, nostr, publishEvent]);

  /**
   * Step one of a deposit: ask the mint for an invoice.
   *
   * The quote is written to storage before it is shown, because between paying
   * the invoice and claiming the proofs the sats exist only as a quote id. A
   * tab closed in that window would otherwise take them with it.
   */
  const requestDeposit = useMutation({
    mutationFn: async (amountSats: number) => {
      if (!pubkey) throw new Error('Log in first');

      const wallet = await loadWallet(mintUrl);

      // No description: NUT-04 makes invoice descriptions optional per method,
      // and a mint that doesn't offer them rejects the quote outright
      const quote = await wallet.createMintQuoteBolt11(amountSats);

      const pending: PendingQuote = {
        quote: quote.quote,
        amountSats,
        request: quote.request,
        expiry: quote.expiry,
        createdAt: Math.floor(Date.now() / 1000),
      };

      addQuote(pubkey, mintUrl, pending);
      void ensureWalletEvent();

      return { quote, pending };
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not reach the mint',
        description: describeMintError(error, mintUrl),
        variant: 'destructive',
      });
    },
  });

  /**
   * Step two: turn a paid quote into proofs.
   *
   * Safe to call more than once. A quote already issued is refused by the
   * mint, so a double click costs an error rather than a double spend.
   */
  const claimDeposit = useMutation({
    mutationFn: async (pending: PendingQuote) => {
      if (!pubkey) throw new Error('Log in first');

      const wallet = await loadWallet(mintUrl);
      const minted = await wallet.mintProofsBolt11(
        pending.amountSats,
        pending.quote
      );

      removeQuote(pubkey, mintUrl, pending.quote);
      await commit(mergeProofs(currentProofs(), minted), []);

      return proofsToSats(minted);
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not claim your deposit',
        description: describeMintError(error, mintUrl),
        variant: 'destructive',
      });
    },
  });

  /**
   * Cuts a token out of the balance.
   *
   * The returned string is the money. It leaves this wallet the moment it is
   * created — not when it is redeemed — so the proofs behind it are recorded
   * as gone immediately. Pasting it back into Receive is how it comes home.
   */
  const send = useMutation({
    mutationFn: async ({
      amountSats,
      memo,
    }: {
      amountSats: number;
      memo?: string;
    }) => {
      const wallet = await loadWallet(mintUrl);
      const available = currentProofs();

      const { keep, send: outgoing } = await wallet.send(
        amountSats,
        available,
        { includeFees: true }
      );

      // The swap spent inputs to make both sides; those originals are gone
      await commit(keep, [...outgoing, ...consumedProofs(available, keep, outgoing)]);

      return encodeToken(outgoing, mintUrl, memo);
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not create the token',
        description: describeMintError(error, mintUrl),
        variant: 'destructive',
      });
    },
  });

  /**
   * Redeems a token someone handed over.
   *
   * Swapped at the mint rather than stored as received, so the proofs become
   * ones only this wallet knows the secrets to. Without that the sender could
   * spend the same token again first.
   */
  const receive = useMutation({
    mutationFn: async (token: string) => {
      const wallet = await loadWallet(mintUrl);
      const trimmed = token.trim();

      const decoded = wallet.decodeToken(trimmed);
      const from = decoded.mint.replace(/\/+$/, '');

      if (from !== mintUrl) {
        throw new Error(
          `That token is from ${mintHost(from)}. This wallet only holds ecash from ${mintHost(mintUrl)}.`
        );
      }

      const received = await wallet.receive(trimmed);
      await commit(mergeProofs(currentProofs(), received), []);

      return proofsToSats(received);
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not redeem that token',
        description: describeMintError(error, mintUrl),
        variant: 'destructive',
      });
    },
  });

  /**
   * Pays a lightning invoice out of the ecash balance.
   *
   * The mint quotes a fee reserve on top of the invoice, and returns whatever
   * it did not need as change. Both the change and the proofs that were never
   * sent go back into the balance in one write, so a failure part way through
   * cannot leave a set of proofs orphaned.
   */
  const payInvoice = useMutation({
    mutationFn: async (invoice: string) => {
      const wallet = await loadWallet(mintUrl);
      const quote = await wallet.createMeltQuoteBolt11(invoice.trim());

      const amount = quote.amount.toNumber();
      const reserve = quote.fee_reserve.toNumber();
      const needed = amount + reserve;
      const available = currentProofs();
      const held = proofsToSats(available);

      if (held < needed) {
        throw new Error(
          `That invoice needs ${needed.toLocaleString()} sats including the mint's fee reserve, and you have ${held.toLocaleString()}.`
        );
      }

      let keep: Proof[];
      let outgoing: Proof[];

      try {
        ({ keep, send: outgoing } = await wallet.send(needed, available, {
          includeFees: true,
        }));
      } catch (error) {
        /**
         * The check above is a floor, not the whole price. NUT-02 lets a mint
         * charge `input_fee_ppk` for every proof spent as an input, and NUT-05
         * requires the wallet to cover `amount + fee_reserve + that fee`. How
         * many inputs it takes is only known once they are selected, which is
         * here — so a balance that clears the floor can still fall short, and
         * saying so beats passing the library's wording through.
         */
        if (held < needed + wallet.getFeesForProofs(available).toNumber()) {
          throw new Error(
            `That invoice needs ${needed.toLocaleString()} sats plus this mint's per-input fee, which is more than the ${held.toLocaleString()} you have.`
          );
        }

        throw error;
      }

      const consumed = consumedProofs(available, keep, outgoing);

      try {
        const result = await wallet.meltProofsBolt11(quote, outgoing);
        const change = result.change ?? [];
        const next = mergeProofs(keep, change);

        await commit(next, [...outgoing, ...consumed]);

        /**
         * Measured rather than estimated. This used to report
         * `reserve - change`, which is the unused part of the routing reserve
         * and misses what the mint charged per input — so the figure shown was
         * smaller than the amount that actually left. Taking it from the
         * balance either side covers both, whatever the mint charges.
         */
        return {
          amountSats: amount,
          feeSats: Math.max(0, held - proofsToSats(next) - amount),
        };
      } catch (error) {
        // The payment may or may not have gone through. Putting the proofs
        // back is safe either way: the next load asks the mint which of them
        // it has already spent and drops those. The inputs the swap consumed
        // are not in that category — those were spent to create `outgoing`
        // and are gone whatever the melt did.
        await commit(mergeProofs(keep, outgoing), consumed);
        throw error;
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Payment failed',
        description: describeMintError(error, mintUrl),
        variant: 'destructive',
      });
    },
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['cashu-proofs'] });
  }, [queryClient]);

  return {
    mintUrl,
    /** False while browsing read-only: nothing here can be signed or backed up. */
    available: !!user && !readOnly,
    proofs,
    balanceSats,
    isLoading: state.isLoading,
    error: state.error as Error | null,
    /** Deposits that were quoted but never claimed. */
    pendingQuotes: pubkey ? readQuotes(pubkey, mintUrl) : [],
    requestDeposit: requestDeposit.mutateAsync,
    isRequestingDeposit: requestDeposit.isPending,
    claimDeposit: claimDeposit.mutateAsync,
    isClaimingDeposit: claimDeposit.isPending,
    send: send.mutateAsync,
    isSending: send.isPending,
    receive: receive.mutateAsync,
    isReceiving: receive.isPending,
    payInvoice: payInvoice.mutateAsync,
    isPaying: payInvoice.isPending,
    refresh,
  };
}

/**
 * Watches a mint quote until the invoice behind it is paid.
 *
 * Polled because the mint's websocket support is optional and this has to work
 * when it is off. Stops the moment the state settles, so an abandoned invoice
 * does not poll forever.
 */
export function useMintQuoteStatus(
  quoteId: string | undefined,
  mintUrl: string = CASHU_MINT_URL
) {
  const queryClient = useQueryClient();
  const [streaming, setStreaming] = useState(false);

  const queryKey = useMemo(
    () => ['cashu-quote', mintUrl, quoteId ?? ''],
    [mintUrl, quoteId]
  );

  const query = useQuery<MintQuoteBolt11Response>({
    queryKey,
    queryFn: async () => {
      const wallet = await loadWallet(mintUrl);
      return wallet.checkMintQuoteBolt11(quoteId!);
    },
    enabled: !!quoteId,
    /**
     * Polling is the fallback, not the mechanism. NUT-17 is optional and a
     * websocket can be blocked by a proxy or dropped mid-invoice, so the poll
     * stays — just slowly once the socket is carrying the news, and at the
     * old rate when it is not.
     */
    refetchInterval: (query) =>
      query.state.data && query.state.data.state !== 'UNPAID'
        ? false
        : streaming
          ? 15_000
          : 3000,
    staleTime: 0,
    retry: false,
  });

  /**
   * The mint tells us the invoice was paid, rather than being asked every
   * three seconds.
   *
   * Someone stares at this screen holding their phone, and the gap between
   * paying and the screen admitting it is the whole experience of depositing.
   * NUT-17 closes it: the mint pushes the state change down an open socket.
   * It also replays the current state on subscribe, so nothing is missed by
   * connecting late.
   */
  useEffect(() => {
    if (!quoteId) return;

    let cancel: (() => void) | undefined;
    let live = true;

    void (async () => {
      try {
        const wallet = await loadWallet(mintUrl);

        const stop = await wallet.on.mintQuotePaid(
          quoteId,
          (payload) => queryClient.setQueryData(queryKey, payload),
          () => setStreaming(false)
        );

        // Unmounted while connecting, so close what we just opened
        if (!live) {
          stop();
          return;
        }

        cancel = stop;
        setStreaming(true);
      } catch {
        // No websocket support, or it would not connect. The poll covers it.
        setStreaming(false);
      }
    })();

    return () => {
      live = false;
      setStreaming(false);
      cancel?.();
    };
  }, [quoteId, mintUrl, queryClient, queryKey]);

  return {
    state: query.data?.state,
    isPaid: query.data?.state === 'PAID',
    isIssued: query.data?.state === 'ISSUED',
  };
}

/**
 * Turns a mint failure into something worth reading.
 *
 * A wallet that says "Failed to fetch" over a balance is indistinguishable
 * from one that has lost the money, and people react accordingly.
 */
export function describeMintError(error: Error, mintUrl: string): string {
  const message = error.message ?? '';

  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `Could not reach ${mintHost(mintUrl)}. Your ecash is untouched — try again when the mint is back.`;
  }

  if (/already (issued|spent)/i.test(message)) {
    return 'The mint has already handled that one. Refresh to see the current balance.';
  }

  return message || 'The mint refused the request.';
}
