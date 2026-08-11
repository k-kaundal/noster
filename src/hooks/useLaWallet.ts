import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { usePayAnyWallet } from '@/hooks/usePayAnyWallet';
import {
  invoiceAmountSats,
  isExpectedDenial,
  unwrapList,
  LAWALLET_DOMAIN,
  laWalletRequest,
  mergeHeldAddresses,
  requiresPayment,
  type AddressMode,
  type AliasProbe,
  type RemoteWallet,
  type ServiceInvoice,
  type WalletAddress,
} from '@/lib/lawallet';

export interface ClaimRequest {
  username: string;
  mode?: AddressMode;
}

/**
 * A name that has to be bought, and what it costs.
 *
 * `amountSats` is null when the invoice carries no amount — rare, but it means
 * the figure is unknown rather than zero, and the two must not be confused
 * where money is concerned.
 */
export interface NamePrice {
  kind: 'price';
  username: string;
  mode: AddressMode;
  invoice: ServiceInvoice;
  amountSats: number | null;
}

export type ClaimOutcome =
  | { kind: 'claimed'; address: WalletAddress }
  | NamePrice;

/**
 * Addresses at `wallet.nostrfeed.com`, which point wherever you tell them.
 *
 * Signed for per request with NIP-98 rather than held as a session. The
 * service will exchange a NIP-98 event for a JWT, and a JWT is worth having
 * when a page makes many calls — but it also bakes in the role at issue time
 * and outlives changes to it, and every route here accepts NIP-98 directly.
 * One signature per action, no token to store or expire, is the simpler
 * arrangement for a handful of deliberate clicks.
 */
export function useLaWallet() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { pay, preferredFor } = usePayAnyWallet();

  const signer = user && !user.readOnly ? user.signer : null;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['lawallet-addresses'] });
  }, [queryClient]);

  /**
   * Reads here are refused for two ordinary reasons — no account yet, or a
   * route whose role this person does not hold — and neither is a failure
   * worth surfacing. Answered as empty so React Query has data to keep, since
   * a query that failed has nothing to go stale and so refetches on every
   * mount.
   */
  const emptyWhenDenied = <T>(fallback: T) => (error: unknown): T => {
    if (isExpectedDenial(error)) return fallback;
    throw error;
  };

  const addresses = useQuery({
    queryKey: ['lawallet-addresses', user?.pubkey ?? ''],
    queryFn: async ({ signal }) => {
      const body = await laWalletRequest<unknown>('/api/wallet/addresses', {
        signer: signer!,
        signal,
      }).catch(emptyWhenDenied<unknown>([]));

      return unwrapList<WalletAddress>(body);
    },
    enabled: !!signer,
    staleTime: 5 * 60_000,
    retry: false,
  });

  /*
   * `GET /api/lightning-addresses` is not called from here.
   *
   * It was, to find addresses linked to a key rather than to an account —
   * genuinely the better question, since a key outlives an account. But the
   * route is marked `VIEWER` in the schema and refuses every ordinary user
   * with `AUTHORIZATION_ERROR`. Keeping it meant each person signing a NIP-98
   * event and being turned away, on a loop, forever.
   *
   * Nothing is lost that this account can have. `/api/wallet/addresses` is
   * role `USER`, returns the caller's own addresses with the same full records
   * — mode, destination, primary flag — and is the endpoint that was always
   * going to answer for somebody who is not an administrator.
   */

  /** The caller's NWC-backed wallets on the service, for CUSTOM_NWC mode. */
  const wallets = useQuery({
    queryKey: ['lawallet-wallets', user?.pubkey ?? ''],
    queryFn: async ({ signal }) => {
      const body = await laWalletRequest<unknown>('/api/remote-wallets', {
        signer: signer!,
        signal,
      }).catch(emptyWhenDenied<unknown>([]));

      return unwrapList<RemoteWallet>(body);
    },
    enabled: !!signer,
    staleTime: 5 * 60_000,
    retry: false,
  });

  /**
   * Whether a name is free.
   *
   * Public, so it needs no signature — which is what lets it run as someone
   * types rather than only when they commit.
   */
  const checkName = useCallback(async (username: string, signal?: AbortSignal) => {
    const body = await laWalletRequest<{ available: boolean }>(
      `/api/lightning-addresses/check?username=${encodeURIComponent(username)}`,
      { signal }
    );

    return body.available;
  }, []);

  /**
   * Asks the service what an address can do before it is used as a
   * destination.
   *
   * Server-side rather than from the browser, and worth preferring to our own
   * check for this purpose: it is the machine that will actually be forwarding
   * the money, so its answer is the one that decides whether the alias works.
   */
  const probeAlias = useCallback(
    async (address: string) =>
      await laWalletRequest<AliasProbe>('/api/wallet/addresses/alias-probe', {
        method: 'POST',
        body: { address },
        signer: signer!,
      }),
    [signer]
  );

  /**
   * Claims a name, paying for it when the instance charges.
   *
   * Whether a name costs anything is a per-instance decision the API does not
   * expose anywhere — there is no price endpoint, and the charge only appears
   * as a refusal when the name is claimed. So the free path is tried first
   * and the refusal is read: if it means "pay first", an invoice is raised
   * for exactly this username, paid from whichever wallet the person already
   * has here, and claimed back with the preimage before the name is asked for
   * again.
   *
   * Deliberately not the other way around. Raising an invoice up front would
   * charge people on instances that give names away.
   */
  const claimName = async (username: string, mode: AddressMode) =>
    await laWalletRequest<WalletAddress>('/api/wallet/addresses', {
      method: 'POST',
      body: { username, mode },
      signer: signer!,
    });

  /**
   * Asks the service what a name costs.
   *
   * The price is not ours to compute. `POST /api/invoices` takes a purpose and
   * a username and nothing else — there is no amount field — so the server
   * decides and the only place the figure appears is inside the BOLT11 it
   * returns. Working it out here from name length or rarity would produce a
   * number that disagrees with what the wallet is about to be charged, which
   * is the one number that must not be wrong.
   */
  const quoteName = async (username: string) => {
    const invoice = await laWalletRequest<ServiceInvoice>('/api/invoices', {
      method: 'POST',
      body: { purpose: 'wallet-address', metadata: { username } },
      signer: signer!,
    });

    return { invoice, amountSats: invoiceAmountSats(invoice.pr) };
  };

  const payForName = async (invoice: ServiceInvoice) => {
    const option = preferredFor(0);
    const result = await pay({ bolt11: invoice.pr, optionId: option.id });

    /**
     * The preimage is what proves the payment happened, and only a wallet
     * inside this app can hand it back. Paying by QR elsewhere leaves nothing
     * here to claim with, so that is said rather than left as a claim that
     * silently fails.
     */
    if (!result.preimage) {
      throw new Error(
        result.paid
          ? 'That wallet paid but did not return a proof of payment, so the name could not be claimed. Contact support with the invoice.'
          : 'This name has to be paid for from a wallet connected here — an invoice paid elsewhere cannot prove itself.'
      );
    }

    await laWalletRequest<ServiceInvoice>(
      `/api/invoices/${encodeURIComponent(invoice.id)}/claim`,
      { method: 'POST', body: { preimage: result.preimage }, signer: signer! }
    );
  };

  /**
   * Claims a name, or comes back with its price.
   *
   * Whether a name costs anything is a per-instance decision the API does not
   * expose anywhere — there is no price endpoint, and the charge only surfaces
   * as a refusal when the name is claimed. So the free path is tried first and
   * the refusal is read: if it means "pay first", an invoice is raised for
   * exactly this username and the amount comes back for someone to agree to.
   *
   * It used to pay that invoice on the spot. Nobody should have their wallet
   * charged by a button labelled "Claim it" without being told the number
   * first — least of all when the number is set by a server and can change
   * without this app knowing.
   */
  const claim = useMutation<ClaimOutcome, Error, ClaimRequest>({
    mutationFn: async ({ username, mode = 'IDLE' }) => {
      try {
        return { kind: 'claimed', address: await claimName(username, mode) };
      } catch (error) {
        if (!requiresPayment(error)) throw error;

        const { invoice, amountSats } = await quoteName(username);
        return { kind: 'price', username, mode, invoice, amountSats };
      }
    },
    onSuccess: (outcome) => {
      if (outcome.kind !== 'claimed') return;

      invalidate();
      toast({
        title: 'Address claimed',
        description: `${outcome.address.username} is yours. Point it somewhere to start receiving.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not claim that name',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /** Pays a price already shown to someone, then takes the name. */
  const buy = useMutation({
    mutationFn: async (quote: NamePrice) => {
      await payForName(quote.invoice);
      return await claimName(quote.username, quote.mode);
    },
    onSuccess: (created) => {
      invalidate();
      toast({
        title: 'Address bought',
        description: `${created.username} is yours. Point it somewhere to start receiving.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not buy that name',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * Points an address at something.
   *
   * `mode` is required by the service on every update, so the destination and
   * the kind of destination always travel together — an address cannot end up
   * claiming to forward with nowhere to forward to.
   */
  const point = useMutation({
    mutationFn: async ({
      username,
      mode,
      redirect,
      remoteWalletId,
    }: {
      username: string;
      mode: AddressMode;
      redirect?: string | null;
      remoteWalletId?: string | null;
    }) =>
      await laWalletRequest<WalletAddress>(
        `/api/wallet/addresses/${encodeURIComponent(username)}`,
        {
          method: 'PUT',
          body: {
            mode,
            ...(redirect !== undefined ? { redirect } : {}),
            ...(remoteWalletId !== undefined ? { remoteWalletId } : {}),
          },
          signer: signer!,
        }
      ),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Address updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not update that address',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * Registers an NWC connection with the service so an address can be paid by
   * it.
   *
   * The connection string is the wallet's spending credential and it is being
   * handed to a server. Worth being plain about in the UI rather than framing
   * as "connect" — the service can spend from that wallet for as long as the
   * connection lives, which is the deal being made.
   */
  const connectWallet = useMutation({
    mutationFn: async ({
      name,
      connectionString,
    }: {
      name: string;
      connectionString: string;
    }) =>
      await laWalletRequest<RemoteWallet>('/api/remote-wallets', {
        method: 'POST',
        body: {
          name,
          type: 'NWC',
          config: { nwcUri: connectionString },
          isDefault: true,
        },
        signer: signer!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lawallet-wallets'] });
      toast({ title: 'Wallet connected' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not connect that wallet',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * Revokes a connection the service holds.
   *
   * Unlike an address, this should be removable and easily: the stored value
   * is an NWC connection string, which is a spending credential for somebody's
   * own wallet sitting on someone else's server. It can spend for as long as
   * it lives, so being unable to withdraw it is the actual problem.
   *
   * The service soft-deletes — the wallet flips to REVOKED rather than
   * vanishing — so nothing is lost from its records and no name is freed. What
   * does stop is any address pointing at it, which is worth saying before the
   * click rather than discovering as silence.
   */
  const revokeWallet = useMutation({
    mutationFn: async (id: string) =>
      await laWalletRequest<void>(`/api/remote-wallets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        signer: signer!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lawallet-wallets'] });
      invalidate();
      toast({
        title: 'Wallet disconnected',
        description:
          'It can no longer spend on your behalf. Addresses pointing at it stop receiving until you point them somewhere else.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not disconnect that wallet',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /* `DELETE /api/wallet/addresses/{username}` is not called from here, for the
   * same reason it is not called against our own pay links: the service's own
   * `/api/lightning-addresses/check` reports a deleted name as available
   * again, so releasing one hands it to whoever asks next — along with every
   * payment still aimed at it.
   *
   * Nothing is lost by leaving it alone. `IDLE` already means "receives
   * nothing", it is reversible, and it does it without giving somebody else
   * your name.
   */

  /**
   * Derived lists, computed once per change rather than once per render.
   *
   * `mergeHeldAddresses` and the wallet filter both build new arrays. Handing
   * a fresh array out of a hook that seven components call means every one of
   * them re-renders on every render of any parent, and anything downstream
   * keyed on those arrays — effects, other queries, `useMemo` chains — runs
   * again each time. That is how a single failing request turned into a
   * request every few hundred milliseconds: not retries, but a query being
   * re-subscribed by components that had no reason to re-render.
   */
  const held = useMemo(
    () => mergeHeldAddresses(addresses.data ?? [], []),
    [addresses.data]
  );

  const activeWallets = useMemo(
    () => (wallets.data ?? []).filter((entry) => entry.status === 'ACTIVE'),
    [wallets.data]
  );

  return useMemo(() => ({
    /** Null when signed out or browsing read-only; nothing here can be signed. */
    available: !!signer,
    /** The caller's own records, with the settings on them. */
    addresses: addresses.data ?? [],
    /**
     * Everything they hold here, including whatever the directory turned up
     * that their own list did not mention.
     */
    held,
    /**
     * Configuration, now that the route which reported it is out of reach.
     * A module constant, so it is the same string every render.
     */
    domain: LAWALLET_DOMAIN,
    isLoading: addresses.isLoading,
    wallets: activeWallets,
    checkName,
    probeAlias,
    claim: claim.mutateAsync,
    isClaiming: claim.isPending,
    buy: buy.mutateAsync,
    isBuying: buy.isPending,
    point: point.mutateAsync,
    isPointing: point.isPending,
    connectWallet: connectWallet.mutateAsync,
    isConnecting: connectWallet.isPending,
    revokeWallet: revokeWallet.mutateAsync,
    isRevoking: revokeWallet.isPending,
  }), [
    signer,
    addresses.data,
    addresses.isLoading,
    held,
    activeWallets,
    checkName,
    probeAlias,
    claim.mutateAsync,
    claim.isPending,
    buy.mutateAsync,
    buy.isPending,
    point.mutateAsync,
    point.isPending,
    connectWallet.mutateAsync,
    connectWallet.isPending,
    revokeWallet.mutateAsync,
    revokeWallet.isPending,
  ]);
}
