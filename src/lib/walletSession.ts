import { lnbitsRequest } from '@/lib/lnbits';
import { defineKey, readStore, writeStore } from '@/lib/store';

/** Session tokens, keyed by the Nostr pubkey they belong to. */
export const WALLET_TOKENS_KEY = 'lnbits:tokens';

export const walletTokensKey = defineKey<Record<string, string>>(
  WALLET_TOKENS_KEY,
  {}
);

/**
 * Ends the LNbits session belonging to one Nostr identity.
 *
 * Goes through the shared store rather than storage directly, so the wallet
 * hooks holding this value are told. Logging out from the account switcher
 * never calls back into them, and a component still showing a balance it can
 * no longer fetch is worse than one showing none.
 *
 * Only this identity's token is dropped. Another account signed in alongside
 * it keeps its own wallet.
 */
export async function endWalletSession(pubkey: string): Promise<void> {
  const token = readStore(walletTokensKey)[pubkey];

  if (token) {
    try {
      await lnbitsRequest('/api/v1/auth/logout', { method: 'POST', token });
    } catch {
      // The server may have expired it already, or be unreachable. Forgetting
      // it here is the part that has to happen either way.
    }
  }

  writeStore(walletTokensKey, (current) => {
    if (!(pubkey in current)) return current;

    const next = { ...current };
    delete next[pubkey];
    return next;
  });
}
