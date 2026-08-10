import { type NLoginType, NUser, useNostrLogin } from '@nostrify/react/login';
import { useNostr } from '@nostrify/react';
import { useCallback, useMemo } from 'react';

import { useAuthor } from './useAuthor.ts';
import { useReadOnlySession } from './useReadOnlySession.ts';
import { ReadOnlySigner, type SessionUser, type SignerMethod } from '@/lib/session';

export function useCurrentUser() {
  const { nostr } = useNostr();
  const { logins } = useNostrLogin();
  const readOnly = useReadOnlySession();

  /**
   * The method is set in each branch rather than copied from `login.type`.
   *
   * Only these three reach this point — the default throws — but that is not
   * something the type system can see, and reading the field back out would
   * let a login type the library adds later arrive here labelled as something
   * this app claims to understand.
   */
  const loginToUser = useCallback((login: NLoginType): SessionUser => {
    const session = (user: NUser, method: SignerMethod): SessionUser => ({
      pubkey: user.pubkey,
      signer: user.signer,
      method,
    });

    switch (login.type) {
      case 'nsec': // Nostr login with secret key
        return session(NUser.fromNsecLogin(login), 'nsec');
      case 'bunker': // Nostr login with NIP-46 "bunker://" URI
        return session(NUser.fromBunkerLogin(login, nostr), 'bunker');
      case 'extension': // Nostr login with NIP-07 browser extension
        return session(NUser.fromExtensionLogin(login), 'extension');
      // Other login types can be defined here
      default:
        throw new Error(`Unsupported login type: ${login.type}`);
    }
  }, [nostr]);

  const users = useMemo(() => {
    const users: SessionUser[] = [];

    for (const login of logins) {
      try {
        // Where the key lives travels with the session: what to say when
        // signing fails depends on whether it was an extension or a bunker
        users.push(loginToUser(login));
      } catch (error) {
        console.warn('Skipped invalid login', login.id, error);
      }
    }

    /**
     * Someone browsing on a borrowed key, appended rather than merged.
     *
     * Only when nothing else is signed in: a read-only session exists to be
     * used instead of a login, and letting one sit behind a real one would
     * mean the app's idea of "you" depended on the order two unrelated stores
     * happened to load in.
     */
    if (!users.length && readOnly.pubkey) {
      users.push({
        pubkey: readOnly.pubkey,
        signer: new ReadOnlySigner(readOnly.pubkey),
        method: 'read-only',
        readOnly: true,
      });
    }

    return users;
  }, [logins, loginToUser, readOnly.pubkey]);

  const user = users[0] as SessionUser | undefined;
  const author = useAuthor(user?.pubkey);

  return {
    user,
    users,
    /** Whether this session can read but not act. */
    isReadOnly: !!user?.readOnly,
    ...author.data,
  };
}
