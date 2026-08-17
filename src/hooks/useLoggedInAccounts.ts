import { useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';
import { useQuery } from '@tanstack/react-query';
import { NSchema as n, NostrEvent, NostrMetadata } from '@nostrify/nostrify';

import { useReadOnlySession } from './useReadOnlySession';
import { useAccountLabels } from './useAccountLabels';
import { signerMethod, type SignerMethod } from '@/lib/session';
import { forgetAll } from '@/lib/eventStore';

export interface Account {
  id: string;
  pubkey: string;
  event?: NostrEvent;
  metadata: NostrMetadata;
  /**
   * Where this account's key lives, or that there isn't one.
   *
   * Absent for a login type this app has no wording for, so an unfamiliar
   * one shows no badge rather than a confidently wrong one.
   */
  method?: SignerMethod;
  /** The private name given to this account on this device, if any. */
  nickname?: string;
}

/**
 * The id a read-only session answers to.
 *
 * It is not a login and has no login id, but the switcher addresses rows by
 * id, so it needs one — a constant rather than a generated value, so that
 * ending the session is a comparison rather than a lookup.
 */
export const READ_ONLY_ID = 'read-only';

export function useLoggedInAccounts() {
  const { nostr } = useNostr();
  const { logins, setLogin, removeLogin } = useNostrLogin();
  const readOnly = useReadOnlySession();
  const { labels } = useAccountLabels();

  /**
   * Only when nothing is signed in, matching `useCurrentUser`. Two ideas of
   * who you are, resolved differently in two places, is how an account
   * switcher starts showing one person and posting as another.
   */
  const browsing = !logins.length && readOnly.pubkey ? readOnly.pubkey : null;

  const pubkeys = browsing ? [browsing] : logins.map((l) => l.pubkey);

  const { data: authors = [] } = useQuery({
    queryKey: ['logins', pubkeys.join(';')],
    queryFn: async ({ signal }) => {
      if (!pubkeys.length) return [];

      const events = await nostr.query(
        [{ kinds: [0], authors: pubkeys }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) },
      );

      const read = (pubkey: string) => {
        const event = events.find((e) => e.pubkey === pubkey);
        try {
          return { event, metadata: n.json().pipe(n.metadata()).parse(event?.content) };
        } catch {
          return { event, metadata: {} as NostrMetadata };
        }
      };

      if (browsing) {
        return [{ id: READ_ONLY_ID, pubkey: browsing, method: 'read-only' as const, ...read(browsing) }];
      }

      return logins.map(({ id, pubkey, type }): Account => ({
        id,
        pubkey,
        method: signerMethod(type),
        ...read(pubkey),
      }));
    },
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    enabled: pubkeys.length > 0,
  });

  /** The private nickname, folded in after the query so renaming is instant. */
  const named = authors.map((account) => ({
    ...account,
    nickname: labels[account.pubkey],
  }));

  // Current user is the first login, or whoever is being browsed as
  const currentUser: Account | undefined = (() => {
    if (browsing) {
      return (
        named[0] ?? {
          id: READ_ONLY_ID,
          pubkey: browsing,
          metadata: {},
          method: 'read-only' as const,
          nickname: labels[browsing],
        }
      );
    }

    const login = logins[0];
    if (!login) return undefined;

    const author = named.find((a) => a.id === login.id);
    return (
      author ?? {
        id: login.id,
        pubkey: login.pubkey,
        metadata: {},
        method: signerMethod(login.type),
        nickname: labels[login.pubkey],
      }
    );
  })();

  // Other users are all logins except the current one
  const otherUsers = named.slice(1) as Account[];

  /**
   * Ending a session, whichever kind it is.
   *
   * A read-only session is not in the login store, so `removeLogin` would
   * silently do nothing to it — the menu item would appear to work and the
   * person would stay signed in as someone they were only looking at.
   */
  const endBrowsing = readOnly.end;
  const removeAccount = useCallback(
    (id: string) => {
      if (id === READ_ONLY_ID) {
        endBrowsing();
      } else {
        removeLogin(id);
      }

      /**
       * The durable store goes too.
       *
       * Everything in it can be refetched, and a browser someone else is about
       * to use should not still be holding the last person's follower lists —
       * public data or not, it is a record of who was signed in here.
       */
      void forgetAll();
    },
    [endBrowsing, removeLogin]
  );

  return {
    authors: named,
    currentUser,
    otherUsers,
    setLogin,
    removeLogin,
    removeAccount,
    /** Whether the current session can read but not sign. */
    isReadOnly: !!browsing,
  };
}
