import { useQueries } from '@tanstack/react-query';
import { useRelays } from '@/hooks/useRelays';
import { relayDisplayName, relayHttpUrl } from '@/lib/relay';
import type { RelayInfo } from '@/hooks/useRelayInfo';
import { NIP40 } from '@/lib/expiration';

/**
 * Which write relays are known to refuse expiring events.
 *
 * Shares the `relay-info` query key with `useRelayInfo`, so opening the relays
 * page and opening the composer read one cache rather than fetching twice —
 * and so the answer this returns is the same answer `NostrProvider` reads when
 * it decides where to publish.
 *
 * Only ever reports relays that said no. A relay whose NIP-11 document could
 * not be fetched — common, since many serve it without CORS headers — is left
 * out entirely rather than guessed about in either direction.
 */
export function useExpirySupport() {
  const { writeUrls } = useRelays();

  const results = useQueries({
    queries: writeUrls.map((url) => ({
      queryKey: ['relay-info', url],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const response = await fetch(relayHttpUrl(url), {
          headers: { Accept: 'application/nostr+json' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
        });

        if (!response.ok) throw new Error(`Relay returned ${response.status}`);
        return (await response.json()) as RelayInfo;
      },
      retry: false,
      staleTime: 30 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
    })),
  });

  const unsupported = writeUrls.filter((url, index) => {
    const nips = results[index]?.data?.supported_nips;
    return Array.isArray(nips) && !nips.includes(NIP40);
  });

  return {
    /** Display names, since this goes straight into a sentence. */
    unsupported: unsupported.map(relayDisplayName),
    /** True when every write relay is known to refuse — nothing will honour it. */
    noneSupport: unsupported.length > 0 && unsupported.length === writeUrls.length,
  };
}
