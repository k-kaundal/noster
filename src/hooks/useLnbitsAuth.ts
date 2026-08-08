import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useToast } from '@/hooks/useToast';
import {
  LNBITS_URL,
  LnbitsError,
  lnbitsRequest,
  loginWithNostr,
  type LnbitsUser,
} from '@/lib/lnbits';

/**
 * Turns a failed sign-in into something someone can act on.
 *
 * The two ways this fails are both server-side settings, and both produce
 * errors that read like a bug in this app. Naming the setting is the
 * difference between "it's broken" and "switch that on".
 */
export function describeLoginFailure(error: Error): string {
  if (!(error instanceof LnbitsError)) return error.message;

  if (error.status === 404 || error.status === 405) {
    return `${LNBITS_URL} doesn't accept Nostr sign-in. The instance needs "nostr-auth-nip98" in its auth_allowed_methods.`;
  }

  if (error.status === 401 || error.status === 403) {
    return `${LNBITS_URL} rejected the signature. Check its nostr_absolute_request_urls setting matches the address this app calls, and that new accounts are allowed.`;
  }

  return error.message;
}

/**
 * The NostrFeed wallet account, authenticated with the user's Nostr key.
 *
 * LNbits accepts a NIP-98 signed event at `/api/v1/auth/nostr`, so there is no
 * password to manage and no API key to paste — the same key that signs notes
 * proves ownership of the wallet.
 */
export function useLnbitsAuth() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Session token, keyed by pubkey.
   *
   * Keyed because this app supports switching Nostr accounts, and a token
   * belongs to exactly one of them — a shared slot would hand the previous
   * account's wallet to whoever logged in next.
   */
  const [tokens, setTokens] = useLocalStorage<Record<string, string>>(
    'lnbits:tokens',
    {}
  );

  const token = user ? tokens[user.pubkey] : undefined;

  const account = useQuery<LnbitsUser | null>({
    queryKey: ['lnbits-account', user?.pubkey, token ?? ''],
    queryFn: async ({ signal }) => {
      try {
        return await lnbitsRequest<LnbitsUser>('/api/v1/auth', {
          token,
          signal,
        });
      } catch (error) {
        // Not being signed in is the normal state, not a failure to report
        if (error instanceof LnbitsError && error.status === 401) return null;
        throw error;
      }
    },
    enabled: !!user,
    staleTime: 60 * 1000,
    retry: false,
  });

  const login = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Log in with Nostr first');

      const issued = await loginWithNostr(user.signer);

      /**
       * A brand new account has no wallet, and an account without one is
       * useless — no balance to show, nothing to receive into. Provisioning it
       * here means signing in is the only step a person ever takes.
       */
      const account = await lnbitsRequest<LnbitsUser>('/api/v1/auth', {
        token: issued,
      });

      if (!account.wallets?.length) {
        await lnbitsRequest('/api/v1/wallet', {
          method: 'POST',
          token: issued,
          body: { name: 'NostrFeed', wallet_type: 'lightning' },
        });
      }

      return issued;
    },
    onSuccess: (issued) => {
      if (issued && user) {
        setTokens((current) => ({ ...current, [user.pubkey]: issued }));
      }
      queryClient.invalidateQueries({ queryKey: ['lnbits-account'] });
      queryClient.invalidateQueries({ queryKey: ['lnbits-wallets'] });
      toast({
        title: 'Wallet connected',
        description: 'Your NostrFeed wallet is ready.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not connect your wallet',
        description: describeLoginFailure(error),
        variant: 'destructive',
      });
    },
  });

  const logout = useCallback(async () => {
    try {
      await lnbitsRequest('/api/v1/auth/logout', { method: 'POST', token });
    } catch {
      // A failed logout still means forgetting the token locally
    }

    if (user) {
      setTokens((current) => {
        const next = { ...current };
        delete next[user.pubkey];
        return next;
      });
    }

    queryClient.removeQueries({ queryKey: ['lnbits-account'] });
    queryClient.removeQueries({ queryKey: ['lnbits-wallets'] });
  }, [token, user, setTokens, queryClient]);

  return {
    /** The LNbits account, or null when not connected. */
    account: account.data ?? null,
    isLoading: account.isLoading,
    isConnected: !!account.data,
    error: account.error as Error | null,
    token,
    connect: login.mutateAsync,
    isConnecting: login.isPending,
    /** Why the last sign-in attempt failed, phrased for a person. */
    connectError: login.error
      ? describeLoginFailure(login.error as Error)
      : null,
    logout,
    instanceUrl: LNBITS_URL,
  };
}
