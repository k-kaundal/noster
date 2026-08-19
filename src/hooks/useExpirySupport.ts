import { useRelays } from '@/hooks/useRelays';
import { useRelayInfos } from '@/hooks/useRelayInfo';
import { relayDisplayName } from '@/lib/relay';
import { refuses } from '@/lib/nip11';
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

  const { infos } = useRelayInfos(writeUrls);

  const unsupported = writeUrls.filter((_url, index) =>
    refuses(infos[index], NIP40)
  );

  return {
    /** Display names, since this goes straight into a sentence. */
    unsupported: unsupported.map(relayDisplayName),
    /** True when every write relay is known to refuse — nothing will honour it. */
    noneSupport: unsupported.length > 0 && unsupported.length === writeUrls.length,
  };
}
