import { useCallback, useSyncExternalStore } from 'react';
import { defineKey, readStore, subscribeStore, writeStore } from '@/lib/store';
import { decodeViewerKey } from '@/lib/session';

/**
 * Whose timeline someone is reading without being them.
 *
 * Kept in our own store rather than in the login store, because it is not a
 * login: there is no key, nothing can be signed, and pretending otherwise
 * would put a session in the account switcher that fails the first time it is
 * asked to do anything.
 */
const VIEWING = defineKey<string>('session:viewing', '');

/**
 * Reading Nostr without handing over a key.
 *
 * The common first question about any Nostr client is whether you can look
 * before you commit, and until now the answer here was no — the only way in
 * was to paste a secret key or install an extension, which is a lot to ask of
 * someone who has not yet decided the app is worth it. It is also what someone
 * does on a machine they do not trust, and being able to browse there without
 * a key on it is the whole point.
 *
 * Deliberately mutually exclusive with a real login: if you have a key in the
 * app, this has nothing to offer you, and two notions of "who am I" competing
 * for the same slot is how accounts get mixed up.
 */
export function useReadOnlySession() {
  const subscribe = useCallback(
    (listener: () => void) => subscribeStore(VIEWING.name, listener),
    []
  );

  const pubkey = useSyncExternalStore(
    subscribe,
    () => readStore(VIEWING),
    () => VIEWING.fallback
  );

  const start = useCallback((input: string) => {
    // Throws with something worth showing when the paste was not an npub
    const decoded = decodeViewerKey(input);
    writeStore(VIEWING, decoded);
    return decoded;
  }, []);

  const end = useCallback(() => {
    writeStore(VIEWING, '');
  }, []);

  return { pubkey: pubkey || null, start, end };
}
