import { useQuery } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { queryGroupRelay } from '@/lib/groupRelay';
import { nip98Header } from '@/lib/lnbits';
import {
  LIVEKIT_PARTICIPANTS,
  livekitSupportUrl,
  livekitTokenUrl,
  parseLivekitParticipants,
} from '@/lib/nip29';

/**
 * Live audio/video rooms attached to a group.
 *
 * The relay is the doorman. A client asks it for a LiveKit token over HTTP
 * with a NIP-98 signature, and the relay decides — against the group's own
 * membership rules — whether to issue one. Nothing here can grant access, and
 * nothing here should try to guess the answer in advance.
 *
 * What this deliberately does not do is speak LiveKit. The spec says to take
 * the token and "proceed with the standard LiveKit flow", which means the
 * LiveKit client SDK; this fetches the credential and reports who is in the
 * room, and stops at the point where that library would begin.
 */

/** Whether the relay offers AV at all, per its well-known 204. */
export function useLivekitSupport(relayUrl: string | undefined) {
  const query = useQuery({
    queryKey: ['nip29-livekit-support', relayUrl ?? ''],
    queryFn: async ({ signal }) => {
      try {
        const response = await fetch(livekitSupportUrl(relayUrl!), {
          method: 'GET',
          signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
        });

        /**
         * The spec names 204 specifically. Accepting any 2xx would also
         * accept a relay's catch-all HTML page, which plenty of hosts serve
         * with a 200 for every unknown path — and then the UI offers a call
         * button that fails when pressed.
         */
        return response.status === 204;
      } catch {
        // A CORS refusal and a missing endpoint are the same answer here
        return false;
      }
    },
    enabled: !!relayUrl,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  return { supported: query.data ?? false, isLoading: query.isLoading };
}

export interface LivekitCredentials {
  token: string;
  url: string;
}

/**
 * Fetches a LiveKit token for a group.
 *
 * Not a `useQuery`: asking for one prompts the signer, so it happens when
 * somebody presses a button and never because a component mounted.
 */
export function useLivekitToken(
  relayUrl: string | undefined,
  groupId: string | undefined
) {
  const { user } = useCurrentUser();

  const requestToken = async (): Promise<LivekitCredentials> => {
    if (!user) throw new Error('Log in first');
    if (!relayUrl || !groupId) throw new Error('No group to join');

    const endpoint = livekitTokenUrl(relayUrl, groupId);

    /**
     * The `u` tag has to be this exact URL. NIP-98 binds the signature to the
     * address being requested, and the spec spells the tag out for this
     * endpoint — a mismatch reads to the relay as a replayed token.
     */
    const authorization = await nip98Header(user.signer, endpoint, 'GET');

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      /**
       * The relay's own words, when it gave any. Access control happens at
       * token issuance, so this is where "you are not a member" arrives, and
       * replacing it with a generic failure would hide the one thing the
       * person needs to know.
       */
      const detail = await response.text().catch(() => '');

      throw new Error(
        detail.trim() || `The relay refused (${response.status}).`
      );
    }

    const payload: unknown = await response.json();

    if (!payload || typeof payload !== 'object') {
      throw new Error('The relay sent back something unreadable.');
    }

    const { token, url } = payload as { token?: unknown; url?: unknown };

    if (typeof token !== 'string' || typeof url !== 'string') {
      throw new Error('The relay did not send a usable token.');
    }

    return { token, url };
  };

  return { requestToken, canRequest: !!user && !!relayUrl && !!groupId };
}

/**
 * Who the relay says is in the room right now.
 *
 * Polled rather than subscribed. The spec expects clients to be "actively
 * subscribed" to kind 39004, and a live subscription would be better — this
 * is the version that works with the request/response helper the rest of the
 * group code uses, and a stale-by-fifteen-seconds participant list is a much
 * smaller problem than a second connection path to maintain.
 */
export function useLivekitParticipants(
  relayUrl: string | undefined,
  groupId: string | undefined,
  enabled = true
) {
  const query = useQuery({
    queryKey: ['nip29-livekit-participants', relayUrl ?? '', groupId ?? ''],
    queryFn: async ({ signal }) => {
      const events = await queryGroupRelay(
        relayUrl!,
        [{ kinds: [LIVEKIT_PARTICIPANTS], '#d': [groupId!], limit: 1 }],
        AbortSignal.any([signal, AbortSignal.timeout(5000)])
      );

      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      return parseLivekitParticipants(latest);
    },
    enabled: enabled && !!relayUrl && !!groupId,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  return { participants: query.data ?? [], isLoading: query.isLoading };
}
