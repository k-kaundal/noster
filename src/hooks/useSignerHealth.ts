import { useCallback, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { readStore, subscribeStore } from '@/lib/store';
import { SIGNER_FAILURES, clearSignerFailure } from '@/lib/signerStatus';

/**
 * How long a remote signer gets to say hello.
 *
 * Generous, because the round trip goes phone → relay → browser and a signer
 * that has been asleep may take a moment to wake. Short enough that someone
 * finds out before they have written a post they cannot publish.
 */
const PROBE_TIMEOUT = 8000;

export type SignerHealth = 'unknown' | 'checking' | 'ok' | 'unreachable';

/**
 * Whether the thing holding your key is still there.
 *
 * A NIP-46 session is a conversation over relays, and conversations end
 * without telling you: the signer app gets closed, the phone drops off the
 * network, the connection token expires, the relay carrying the two of you
 * stops accepting. None of that produces an event. The app found out only when
 * it next asked for a signature — precisely the moment someone had finished
 * writing something, the worst possible time to learn the key is unreachable.
 *
 * Two sources, because neither is sufficient alone:
 *
 * - **A signature that failed.** Unambiguous — a signer cannot fake having
 *   signed — but only available after someone has already lost a post to it.
 * - **A probe.** `getPublicKey` is the cheapest question NIP-46 takes and
 *   needs no approval, so it can be asked before anyone is waiting on it. It
 *   is weaker evidence: a signer that answers from a local cache would answer
 *   this without the remote end being alive at all. It can therefore confirm
 *   trouble but never fully clear it, which is why a recorded failure is only
 *   dropped by a real signature going through.
 *
 * Only remote signers are considered. An extension answers or throws
 * immediately, and a key in memory cannot become unreachable.
 */
export function useSignerHealth() {
  const { user } = useCurrentUser();
  const remote = user?.method === 'bunker';
  const pubkey = user?.pubkey ?? '';

  const subscribe = useCallback(
    (listener: () => void) => subscribeStore(SIGNER_FAILURES.name, listener),
    []
  );

  const recorded = useSyncExternalStore(
    subscribe,
    () => (pubkey ? readStore(SIGNER_FAILURES)[pubkey] : undefined),
    () => undefined
  );

  const query = useQuery({
    queryKey: ['signer-health', pubkey],
    queryFn: async () => {
      if (!user) return false;

      return await Promise.race([
        user.signer.getPublicKey().then(() => true),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), PROBE_TIMEOUT)
        ),
      ]).catch(() => false);
    },
    enabled: remote,
    // Coming back to the tab is exactly when the phone may have dropped off
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    // A dead bunker stays dead; retrying only delays telling the person
    retry: false,
  });

  const probeFailed = remote && query.data === false;

  const status: SignerHealth = !remote
    ? 'unknown'
    : recorded === 'unreachable' || probeFailed
      ? 'unreachable'
      : query.data
        ? 'ok'
        : query.isFetching
          ? 'checking'
          : 'unknown';

  /**
   * Re-asking, after the person has done something about it.
   *
   * The recorded failure is cleared first: it is a memory of one moment, and
   * keeping it would outvote every probe from here on — the banner would
   * never come down until something was successfully signed, which is the
   * thing the banner exists to make possible.
   */
  const recheck = useCallback(async () => {
    clearSignerFailure(pubkey);
    return await query.refetch();
  }, [pubkey, query]);

  return {
    status,
    /** True only when we know it is not answering, never merely while asking. */
    isUnreachable: status === 'unreachable',
    recheck,
  };
}
