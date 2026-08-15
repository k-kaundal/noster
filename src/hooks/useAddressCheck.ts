import { useQuery } from '@tanstack/react-query';
import { fetchPayMetadata } from '@/lib/lnurlPay';
import { parseLightningAddress } from '@/lib/lightningAddress';

/**
 * Whether a lightning address actually works, before it goes on a profile.
 *
 * An address is just a string until someone tries to pay it, and a wrong one
 * fails silently and permanently: the zap button on every post keeps looking
 * like it works, payers see an error they assume is their own wallet, and the
 * person being paid finds out weeks later when they wonder why nobody zaps
 * them. A typo like `getalby.con` is indistinguishable from a working address
 * by looking at it.
 *
 * So it is fetched. LUD-16 says the address resolves to a well-known URL
 * serving an LNURL-pay offer, which needs no key and no permission to ask
 * for, and either comes back or does not.
 *
 * NIP-57 support is reported separately, because it is the part people are
 * surprised by: plenty of providers serve LNURL-pay perfectly and cannot
 * produce zap receipts, so zaps to them fail while ordinary payments work.
 */
export type AddressCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'invalid'; reason: string }
  | { status: 'unreachable'; reason: string }
  | {
      status: 'ok';
      /** Whether zaps, as opposed to plain payments, will work. */
      zaps: boolean;
      /**
       * The server said it does zaps but named no usable key to sign them
       * with.
       *
       * Worth telling apart from a provider that simply does not do zaps,
       * because it is a misconfiguration rather than a limitation — and it is
       * the shape our own LNbits takes when the pay link has zaps switched on
       * but nothing is actually publishing receipts.
       */
      zapsMisconfigured: boolean;
      minSats: number;
      maxSats: number;
      description: string;
    };

/** How long to wait before deciding a domain is not answering. */
const CHECK_TIMEOUT = 8000;

export function useAddressCheck(input: string, enabled = true): AddressCheck {
  const parsed = parseLightningAddress(input);
  const address = parsed.address;

  const query = useQuery({
    queryKey: ['address-check', address?.address ?? ''],
    queryFn: async ({ signal }) => {
      const metadata = await fetchPayMetadata(
        address!.lnurlpUrl,
        AbortSignal.any([signal, AbortSignal.timeout(CHECK_TIMEOUT)])
      );

      return metadata;
    },
    enabled: enabled && !!address,
    // The answer is a property of someone else's server, not of this session
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!input.trim()) return { status: 'idle' };

  if (!address) {
    return {
      status: 'invalid',
      reason: parsed.problem === 'not-an-address'
        ? 'A lightning address looks like you@example.com.'
        : 'That is not a lightning address.',
    };
  }

  if (!enabled) return { status: 'idle' };
  if (query.isPending || query.isFetching) return { status: 'checking' };

  if (query.error) {
    /**
     * A failure here is nearly always the domain, not the person: a typo, a
     * server that is down, or a provider that does not serve the well-known
     * route. Worth saying which address failed, since the whole point is that
     * it looked right.
     */
    return {
      status: 'unreachable',
      reason: `${address.domain} did not return a payment offer for "${address.name}".`,
    };
  }

  if (!query.data) return { status: 'checking' };

  return {
    status: 'ok',
    zaps: query.data.zapCapable,
    zapsMisconfigured: query.data.allowsNostr && !query.data.zapCapable,
    minSats: Math.ceil(query.data.minSendableMsat / 1000),
    maxSats: Math.floor(query.data.maxSendableMsat / 1000),
    description: query.data.description,
  };
}
