import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { endWalletSession } from '@/lib/walletSession';

/**
 * Ends a wallet session and clears what was cached from it.
 *
 * Signing out of Nostr has to take the wallet with it: the wallet is reached
 * by proving ownership of that key, so leaving the session open would hand the
 * balance to whoever used the browser next.
 */
export function useWalletLogout() {
  const queryClient = useQueryClient();

  return useCallback(
    async (pubkey: string) => {
      await endWalletSession(pubkey);

      // Balances and account details outlive the token in the cache otherwise,
      // and would be shown to the next person to sign in
      queryClient.removeQueries({ queryKey: ['lnbits-account'] });
      queryClient.removeQueries({ queryKey: ['lnbits-wallets'] });
      // Names belong to the account too, and outlived it here — so the next
      // account to sign in was greeted by the previous one's list
      queryClient.removeQueries({ queryKey: ['nip5-addresses'] });
      queryClient.removeQueries({ queryKey: ['lnurlp-links'] });
      queryClient.removeQueries({ queryKey: ['lnbits-payments'] });
      queryClient.removeQueries({ queryKey: ['lnbits-invoice'] });
    },
    [queryClient]
  );
}
