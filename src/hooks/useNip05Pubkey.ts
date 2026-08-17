import { useQuery } from '@tanstack/react-query';

import {
  localDomains,
  nip05Url,
  readNip05Pubkey,
  readNip05Relays,
  type Handle,
} from '@/lib/nip05Lookup';

/** Long enough for a domain to answer, short enough not to hang a page. */
const LOOKUP_TIMEOUT = 6000;

export interface Nip05Resolution {
  pubkey: string;
  /** The domain that actually answered, which a bare name does not name. */
  domain: string;
  /** Relay hints the domain published for this key, if any. */
  relays: string[];
}

async function lookup(
  name: string,
  domain: string,
  signal: AbortSignal
): Promise<Nip05Resolution | null> {
  const response = await fetch(nip05Url(name, domain), { signal });
  if (!response.ok) return null;

  const body = (await response.json()) as unknown;
  const pubkey = readNip05Pubkey(body, name);
  if (!pubkey) return null;

  return { pubkey, domain, relays: readNip05Relays(body, pubkey) };
}

/**
 * Resolves `@alice` or `@alice@somewhere.com` to a public key.
 *
 * A bare name is looked for on this instance's own domains, in order, and the
 * first that answers wins. Sequentially rather than in parallel: the order is
 * a preference, and racing them would make which domain answers depend on
 * which one was quicker that second — so the same name could resolve to two
 * different people on two page loads.
 */
export function useNip05Pubkey(handle: Handle | null) {
  return useQuery({
    queryKey: ['nip05-lookup', handle?.name ?? '', handle?.domain ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([
        c.signal,
        AbortSignal.timeout(LOOKUP_TIMEOUT),
      ]);

      const domains = handle!.domain ? [handle!.domain] : localDomains();

      for (const domain of domains) {
        /*
         * A domain that is down, refuses CORS, or serves something that is not
         * JSON is a domain with no answer — not a reason to stop asking the
         * others, and not an error worth showing when another one may know.
         */
        const found = await lookup(handle!.name, domain, signal).catch(
          () => null
        );

        if (found) return found;
      }

      return null;
    },
    enabled: !!handle,
    /**
     * Names move rarely, and a resolution that is briefly stale sends somebody
     * to a profile rather than to nothing.
     */
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}
