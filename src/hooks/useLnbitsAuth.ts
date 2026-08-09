import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useWalletLogout } from '@/hooks/useWalletLogout';
import { useToast } from '@/hooks/useToast';
import {
  LNBITS_URL,
  LnbitsError,
  isMissingSession,
  lnbitsRequest,
  loginWithNostr,
  loginWithPassword,
  loginWithUserId,
  parseUserId,
  type LnbitsUser,
} from '@/lib/lnbits';
import { WALLET_TOKENS_KEY } from '@/lib/walletSession';

/**
 * Turns a failed sign-in into something someone can act on.
 *
 * The two ways this fails are both server-side settings, and both produce
 * errors that read like a bug in this app. Naming the setting is the
 * difference between "it's broken" and "switch that on".
 */
export function describeLoginFailure(
  error: Error,
  method: 'nostr' | 'user-id' = 'nostr'
): string {
  if (!(error instanceof LnbitsError)) return error.message;

  // LNbits refuses a disabled sign-in method with this exact shape, whichever
  // method it was, and the setting to change is named after the method
  if (error.status === 403 && /not allowed/i.test(error.message)) {
    const setting = method === 'nostr' ? 'nostr-auth-nip98' : 'user-id-only';
    return `${LNBITS_URL} has that sign-in switched off. The instance needs "${setting}" in its auth_allowed_methods.`;
  }

  // The remaining advice is about signature checking, which only the Nostr
  // flow does — offering it for a pasted account id would misdirect
  if (method !== 'nostr') return error.message;

  /**
   * LNbits does not compare the `u` tag to the URL it was called on: it builds
   * the list it will accept from `nostr_absolute_request_urls`, which ships
   * pointing at localhost. Until that setting names this instance no signature
   * can satisfy it, so the value to add is the useful thing to say.
   */
  if (/tag 'u'/i.test(error.message)) {
    return `${LNBITS_URL} is not expecting sign-ins addressed to itself. Add "${LNBITS_URL}" to its nostr_absolute_request_urls setting — it ships listing only localhost, so every signature is rejected until then.`;
  }

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
    WALLET_TOKENS_KEY,
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
        // Having no session is the normal state on a device you haven't
        // connected yet, not a failure worth showing anyone
        if (isMissingSession(error)) return null;
        throw error;
      }
    },
    enabled: !!user,
    staleTime: 60 * 1000,
    retry: false,
  });

  /**
   * Everything that has to happen after a token is issued, whichever way it
   * was obtained.
   *
   * A brand new account has no wallet, and an account without one is useless —
   * no balance to show, nothing to receive into. Provisioning it here means
   * signing in is the only step a person ever takes.
   *
   * An account that already exists is left alone. It may have wallets, a
   * lightning address and a balance from before this app ever saw it, and none
   * of that is ours to reorganise.
   */
  const finishSignIn = useCallback(async (issued: string | undefined) => {
    const existing = await lnbitsRequest<LnbitsUser>('/api/v1/auth', {
      token: issued,
    });

    if (!existing.wallets?.length) {
      await lnbitsRequest('/api/v1/wallet', {
        method: 'POST',
        token: issued,
        body: { name: 'NostrFeed', wallet_type: 'lightning' },
      });
    }

    return issued;
  }, []);

  const storeToken = useCallback(
    (issued: string | undefined) => {
      if (issued && user) {
        setTokens((current) => ({ ...current, [user.pubkey]: issued }));
      }
      queryClient.invalidateQueries({ queryKey: ['lnbits-account'] });
      queryClient.invalidateQueries({ queryKey: ['lnbits-wallets'] });
    },
    [user, setTokens, queryClient]
  );

  const login = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Log in with Nostr first');
      return finishSignIn(await loginWithNostr(user.signer));
    },
    onSuccess: (issued) => {
      storeToken(issued);
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

  /**
   * The same wallet, reached with a username and password.
   *
   * Needed on any device where the Nostr signer isn't installed, and for
   * people who already had an LNbits account before they found this app. The
   * account it opens may be bound to a different Nostr key than the one signed
   * in here; the wallet page says so and offers to relink rather than doing it
   * silently.
   */
  const loginWithCredentials = useMutation({
    mutationFn: async ({
      username,
      password,
    }: {
      username: string;
      password: string;
    }) => {
      const issued = await loginWithPassword(username, password);
      return finishSignIn(issued);
    },
    onSuccess: (issued) => {
      storeToken(issued);
      toast({ title: 'Signed in', description: 'Your wallet is ready.' });
    },
    onError: (error: Error) => {
      const wrong = error instanceof LnbitsError && error.status === 401;

      toast({
        title: wrong ? 'Wrong username or password' : 'Could not sign in',
        description: wrong ? 'Check them and try again.' : error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * The same wallet, reached with the account id from a `?usr=` link.
   *
   * Accounts made before this app existed usually have no username or password
   * at all — the link is the only credential they were ever given, so without
   * this there is no way for those people to reach an existing balance.
   */
  const loginWithLink = useMutation({
    mutationFn: async (input: string) => {
      const usr = parseUserId(input);
      if (!usr) {
        throw new Error(
          'That does not look like a wallet link or account id.'
        );
      }

      return finishSignIn(await loginWithUserId(usr));
    },
    onSuccess: (issued) => {
      storeToken(issued);
      toast({ title: 'Signed in', description: 'Your wallet is ready.' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not sign in',
        description: describeLoginFailure(error, 'user-id'),
        variant: 'destructive',
      });
    },
  });

  const logoutWallet = useWalletLogout();

  const logout = useCallback(async () => {
    if (!user) return;

    await logoutWallet(user.pubkey);

    // Storage is already cleared by the shared path; this drops the copy this
    // hook is holding, which nothing else can reach in to update
    setTokens((current) => {
      const next = { ...current };
      delete next[user.pubkey];
      return next;
    });
  }, [user, logoutWallet, setTokens]);

  return {
    /** The LNbits account, or null when not connected. */
    account: account.data ?? null,
    isLoading: account.isLoading,
    isConnected: !!account.data,
    error: account.error as Error | null,
    token,
    connect: login.mutateAsync,
    isConnecting: login.isPending,
    /** Sign in to the same wallet with a username and password. */
    connectWithPassword: loginWithCredentials.mutateAsync,
    isConnectingWithPassword: loginWithCredentials.isPending,
    /** Sign in with the account id from an existing wallet link. */
    connectWithLink: loginWithLink.mutateAsync,
    isConnectingWithLink: loginWithLink.isPending,
    /** Why the last sign-in attempt failed, phrased for a person. */
    connectError: login.error
      ? describeLoginFailure(login.error as Error)
      : null,
    logout,
    instanceUrl: LNBITS_URL,
  };
}
