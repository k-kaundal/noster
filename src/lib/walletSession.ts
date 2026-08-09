import { lnbitsRequest } from '@/lib/lnbits';

/** Session tokens, keyed by the Nostr pubkey they belong to. */
export const WALLET_TOKENS_KEY = 'lnbits:tokens';

function readTokens(): Record<string, string> {
  try {
    const raw = localStorage.getItem(WALLET_TOKENS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    // Unreadable or disabled storage means no session to end
    return {};
  }
}

function writeTokens(tokens: Record<string, string>): void {
  try {
    localStorage.setItem(WALLET_TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // Nothing can be persisted, so nothing was persisted to remove
  }
}

/**
 * Ends the LNbits session belonging to one Nostr identity.
 *
 * Storage is read here rather than through `useLocalStorage`, whose state only
 * syncs between tabs — a second instance in this tab still holds whatever it
 * read when it mounted. Connecting a wallet and then logging out without a
 * reload would leave that snapshot empty, and the session would be forgotten
 * locally while staying open on the server.
 *
 * Only this identity's token is dropped. Another account signed in alongside
 * it keeps its own wallet.
 */
export async function endWalletSession(pubkey: string): Promise<void> {
  const tokens = readTokens();
  const token = tokens[pubkey];

  if (token) {
    try {
      await lnbitsRequest('/api/v1/auth/logout', { method: 'POST', token });
    } catch {
      // The server may have expired it already, or be unreachable. Forgetting
      // it here is the part that has to happen either way.
    }
  }

  if (pubkey in tokens) {
    delete tokens[pubkey];
    writeTokens(tokens);
  }
}
