import { useQueries, useQuery } from '@tanstack/react-query';
import { relayHttpUrl } from '@/lib/relay';
import type { RelayInfo } from '@/lib/nip11';

/**
 * The document's shape lives in `lib/nip11` alongside the code that reads it,
 * so a plain function can ask what a relay supports without importing a hook.
 */
export type { RelayInfo };

/** Shared by every caller that fetches a NIP-11 document. */
export const RELAY_INFO_STALE_TIME = 30 * 60 * 1000;

/**
 * One relay's document, over HTTP.
 *
 * Written once and shared by every caller through the `relay-info` query key,
 * so the relays page, the composer and the search box read one cache between
 * them rather than fetching the same document three times.
 */
async function fetchRelayInfo(
  url: string,
  signal: AbortSignal
): Promise<RelayInfo> {
  const response = await fetch(relayHttpUrl(url), {
    headers: { Accept: 'application/nostr+json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
  });

  if (!response.ok) {
    throw new Error(`Relay returned ${response.status}`);
  }

  return (await response.json()) as RelayInfo;
}

/** The query options every caller uses, so they all share one cache entry. */
export function relayInfoQuery(url: string) {
  return {
    queryKey: ['relay-info', url],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchRelayInfo(url, signal),
    retry: false,
    staleTime: RELAY_INFO_STALE_TIME,
    gcTime: 60 * 60 * 1000,
  };
}

/**
 * Fetches a relay's NIP-11 document. The spec serves it from the same URI as
 * the websocket endpoint, over HTTP, behind an `application/nostr+json` Accept
 * header. Many relays don't send CORS headers, so failures are expected and
 * surface as "info unavailable" rather than an error state.
 */
export function useRelayInfo(url: string | undefined) {
  return useQuery<RelayInfo | null>({
    ...relayInfoQuery(url ?? ''),
    queryKey: ['relay-info', url],
    queryFn: ({ signal }) => (url ? fetchRelayInfo(url, signal) : null),
    enabled: !!url,
  });
}

/**
 * The same, for several relays at once.
 *
 * Reads are fanned out across every read relay, so questions like "can search
 * run on the relay" are questions about the *set* — see `anySupports`.
 */
export function useRelayInfos(urls: readonly string[]) {
  return useQueries({
    queries: urls.map((url) => relayInfoQuery(url)),
    combine: (results) => ({
      infos: results.map((result) => result.data ?? null),
      isLoading: results.some((result) => result.isLoading),
    }),
  });
}
