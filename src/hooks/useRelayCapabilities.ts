import { useMemo } from 'react';

import { useRelays } from '@/hooks/useRelays';
import { useRelayInfos } from '@/hooks/useRelayInfo';
import { NIP, anySupports, supports, type Support } from '@/lib/nip11';

/**
 * What the relays this app reads from can actually do.
 *
 * Reads are fanned out, so these are questions about the *set*: one relay with
 * a full-text index makes search work, and one relay that answers COUNT makes
 * exact follower counts possible. See `anySupports` for why one relay saying
 * no proves nothing.
 *
 * Costs one HTTP request per relay, cached for half an hour and shared with
 * the relays page and the composer through the `relay-info` query key.
 */
export function useRelayCapabilities() {
  const { readUrls, primaryUrl } = useRelays();
  const { infos } = useRelayInfos(readUrls);

  return useMemo(() => {
    const primaryIndex = readUrls.indexOf(primaryUrl);
    const primary = primaryIndex >= 0 ? infos[primaryIndex] : null;

    return {
      search: anySupports(infos, NIP.SEARCH),
      count: anySupports(infos, NIP.COUNT),
      auth: anySupports(infos, NIP.AUTH),
      negentropy: anySupports(infos, NIP.NEGENTROPY),

      /**
       * A relay that answers COUNT, by URL, or undefined.
       *
       * COUNT is answered by one relay rather than fanned out — a count is not
       * a set that can be merged, and adding two relays' answers would double
       * anything they both hold. The primary is preferred so the number is at
       * least stable between reads.
       */
      countUrl:
        supports(primary, NIP.COUNT)
          ? primaryUrl
          : readUrls.find((_url, index) => supports(infos[index], NIP.COUNT)),
    };
  }, [infos, readUrls, primaryUrl]);
}

export type { Support };
