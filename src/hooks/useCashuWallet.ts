import { useCallback, useMemo } from 'react';
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
  dropSpentProofs,
  encodeToken,
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

  const pubkey = user?.pubkey;
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
      if (!user || !pubkey) return EMPTY;

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
      const proofs = await dropSpentProofs(claimed, mintUrl);

      writeProofs(pubkey, mintUrl, proofs);

      return { proofs, eventIds };
    },
    enabled: !!user,
    staleTime: 30 * 1000,
    retry: false,
  });

  const proofs = state.data?.proofs ?? [];
  const balanceSats = proofsToSats(proofs);

  /** The freshest proof set, read past any stale render. */
  const currentProofs = useCallback(
    () => queryClient.getQueryData<EcashState>(queryKey)?.proofs ?? [],
    [queryClient, queryKey]
  );

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
      if (!user || !pubkey) return;

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
    [user, pubkey, mintUrl, queryClient, publishEvent, toast, queryKey]
  );

  /**
   * Publishes the wallet event other NIP-60 clients look for.
   *
   * It names the mint and carries a key that nutzaps can be locked to. Written
   * once, when the first deposit is requested, so someone who only browses
   * never has an unexplained event on their profile.
   */
  const ensureWalletEvent = useCallback(async () => {
    if (!user || !pubkey) return;

    try {
      const existing = await nostr.query(
        [{ kinds: [WALLET_KIND], authors: [pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(4000) }
      );

      if (existing.length) return;

      const content = await buildWalletContent(
        user.signer as Nip44Signer,
        pubkey,
        { mints: [mintUrl], privkey: bytesToHex(generateSecretKey()) }
      );

      await publishEvent({ kind: WALLET_KIND, content, tags: [] });
    } catch {
      // Nice to have, not required to hold ecash
    }
  }, [user, pubkey, mintUrl, nostr, publishEvent]);

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

      await commit(keep, outgoing);

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

      if (proofsToSats(available) < needed) {
        throw new Error(
          `That invoice needs ${needed.toLocaleString()} sats including the mint's fee reserve, and you have ${proofsToSats(available).toLocaleString()}.`
        );
      }

      const { keep, send: outgoing } = await wallet.send(needed, available, {
        includeFees: true,
      });

      try {
        const result = await wallet.meltProofsBolt11(quote, outgoing);
        const change = result.change ?? [];

        await commit(mergeProofs(keep, change), outgoing);

        return {
          amountSats: amount,
          feeSats: Math.max(0, reserve - proofsToSats(change)),
        };
      } catch (error) {
        // The payment may or may not have gone through. Putting the proofs
        // back is safe either way: the next load asks the mint which of them
        // it has already spent and drops those.
        await commit(mergeProofs(keep, outgoing), []);
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
  const query = useQuery<MintQuoteBolt11Response>({
    queryKey: ['cashu-quote', mintUrl, quoteId ?? ''],
    queryFn: async () => {
      const wallet = await loadWallet(mintUrl);
      return wallet.checkMintQuoteBolt11(quoteId!);
    },
    enabled: !!quoteId,
    refetchInterval: (query) =>
      query.state.data && query.state.data.state !== 'UNPAID' ? false : 3000,
    staleTime: 0,
    retry: false,
  });

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
