import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import {
  laWalletRequest,
  type AddressMode,
  type AliasProbe,
  type RemoteWallet,
  type WalletAddress,
} from '@/lib/lawallet';

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

  const signer = user && !user.readOnly ? user.signer : null;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['lawallet-addresses'] });
  }, [queryClient]);

  const addresses = useQuery({
    queryKey: ['lawallet-addresses', user?.pubkey ?? ''],
    queryFn: async ({ signal }) => {
      const body = await laWalletRequest<{ data: WalletAddress[] }>(
        '/api/wallet/addresses',
        { signer: signer!, signal }
      );

      return body.data ?? [];
    },
    enabled: !!signer,
    staleTime: 30_000,
    /**
     * A person with no account there yet is the normal case, not an error
     * worth retrying three times over — the service answers 404 until they
     * first do something.
     */
    retry: false,
  });

  /** The caller's NWC-backed wallets on the service, for CUSTOM_NWC mode. */
  const wallets = useQuery({
    queryKey: ['lawallet-wallets', user?.pubkey ?? ''],
    queryFn: async ({ signal }) =>
      await laWalletRequest<RemoteWallet[]>('/api/remote-wallets', {
        signer: signer!,
        signal,
      }),
    enabled: !!signer,
    staleTime: 60_000,
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

  const claim = useMutation({
    mutationFn: async ({
      username,
      mode = 'IDLE',
    }: {
      username: string;
      mode?: AddressMode;
    }) =>
      await laWalletRequest<WalletAddress>('/api/wallet/addresses', {
        method: 'POST',
        body: { username, mode },
        signer: signer!,
      }),
    onSuccess: (created) => {
      invalidate();
      toast({
        title: 'Address claimed',
        description: `${created.username} is yours. Point it somewhere to start receiving.`,
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

  const remove = useMutation({
    mutationFn: async (username: string) =>
      await laWalletRequest<void>(
        `/api/wallet/addresses/${encodeURIComponent(username)}`,
        { method: 'DELETE', signer: signer! }
      ),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Address removed' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not remove that address',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    /** Null when signed out or browsing read-only; nothing here can be signed. */
    available: !!signer,
    addresses: addresses.data ?? [],
    isLoading: addresses.isLoading,
    wallets: (wallets.data ?? []).filter((entry) => entry.status === 'ACTIVE'),
    checkName,
    probeAlias,
    claim: claim.mutateAsync,
    isClaiming: claim.isPending,
    point: point.mutateAsync,
    isPointing: point.isPending,
    connectWallet: connectWallet.mutateAsync,
    isConnecting: connectWallet.isPending,
    remove: remove.mutateAsync,
    isRemoving: remove.isPending,
  };
}
