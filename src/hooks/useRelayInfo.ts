import { useQuery } from '@tanstack/react-query';
import { relayHttpUrl } from '@/lib/relay';

/** NIP-11 relay information document. Every field is optional by spec. */
export interface RelayInfo {
  name?: string;
  description?: string;
  banner?: string;
  icon?: string;
  pubkey?: string;
  contact?: string;
  software?: string;
  version?: string;
  supported_nips?: number[];
  terms_of_service?: string;
  privacy_policy?: string;
  limitation?: {
    max_message_length?: number;
    max_subscriptions?: number;
    max_limit?: number;
    max_subid_length?: number;
    max_event_tags?: number;
    max_content_length?: number;
    min_pow_difficulty?: number;
    auth_required?: boolean;
    payment_required?: boolean;
    restricted_writes?: boolean;
    created_at_lower_limit?: number;
    created_at_upper_limit?: number;
    default_limit?: number;
  };
  retention?: {
    kinds?: (number | number[])[];
    count?: number;
    time?: number | null;
  }[];
  relay_countries?: string[];
  language_tags?: string[];
  tags?: string[];
  posting_policy?: string;
  payments_url?: string;
  fees?: {
    admission?: { amount: number; unit: string }[];
    subscription?: { amount: number; unit: string; period: number }[];
    publication?: { kinds?: number[]; amount: number; unit: string }[];
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
    queryKey: ['relay-info', url],
    queryFn: async ({ signal }) => {
      if (!url) return null;

      const response = await fetch(relayHttpUrl(url), {
        headers: { Accept: 'application/nostr+json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
      });

      if (!response.ok) {
        throw new Error(`Relay returned ${response.status}`);
      }

      return (await response.json()) as RelayInfo;
    },
    enabled: !!url,
    retry: false,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}
