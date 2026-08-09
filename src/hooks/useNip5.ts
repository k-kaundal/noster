import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDebounce } from '@/hooks/useDebounce';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  LnbitsError,
  lnbitsRequest,
  readBolt11,
  withExtension,
} from '@/lib/lnbits';
import {
  NIP5_DOMAIN,
  NIP5_DOMAIN_ID,
  formatNip5,
  isNip5Configured,
  readClaimedAddress,
  readPaymentHash,
  validateLocalPart,
  type Nip5Address,
  type Nip5AddressStatus,
} from '@/lib/nip5';

/** What a claim leaves behind: the name, and the invoice that activates it. */
export interface PendingNip5 {
  address: Nip5Address | null;
  bolt11: string;
  paymentHash?: string;
}

const EXTENSION = 'nostrnip5';
const BASE = `/${EXTENSION}/api/v1`;

/**
 * Whether a failure means the extension isn't there.
 *
 * `nostrnip5` is an optional LNbits extension. On an instance without it every
 * route here 404s, which would otherwise surface as a broken feature rather
 * than one that was never switched on.
 */
export function isExtensionMissing(error: unknown): boolean {
  return error instanceof LnbitsError && error.status === 404;
}

/**
 * Is this name free, and what does it cost?
 *
 * The price comes back with the answer because the extension charges by
 * character count, by rank and by promotion — a short name costs more than a
 * long one, and there is no way to know which rule applied without asking.
 */
export function useNip5Search(localPart: string, years = 1) {
  const { token, isConnected } = useLnbitsAuth();
  const query = useDebounce(localPart.trim(), 350);

  const valid = !validateLocalPart(query);

  return useQuery<Nip5AddressStatus>({
    queryKey: ['nip5-search', NIP5_DOMAIN_ID, query, years],
    queryFn: ({ signal }) =>
      withExtension(EXTENSION, token, () =>
        lnbitsRequest<Nip5AddressStatus>(
          `${BASE}/domain/${NIP5_DOMAIN_ID}/search?q=${encodeURIComponent(query)}&years=${years}`,
          { token, signal }
        )
      ),
    enabled: isNip5Configured() && isConnected && valid,
    staleTime: 30 * 1000,
    retry: false,
  });
}

/**
 * Watches the invoice behind a claim until the name goes live.
 *
 * Polled because the name is not usable until the payment settles, and a
 * person who has just paid stares at the screen waiting for it to say so.
 */
export function useNip5Payment(paymentHash: string | undefined) {
  return useQuery<boolean>({
    queryKey: ['nip5-payment', paymentHash ?? ''],
    queryFn: async ({ signal }) => {
      const body = await lnbitsRequest<Record<string, unknown>>(
        `${BASE}/domain/${NIP5_DOMAIN_ID}/payments/${paymentHash}`,
        { signal }
      );

      return body.paid === true || body.status === 'success';
    },
    enabled: isNip5Configured() && !!paymentHash,
    refetchInterval: (query) => (query.state.data ? false : 3000),
    retry: false,
  });
}

/**
 * The user's NIP-05 identifiers, and buying one.
 *
 * Distinct from `useLightningAddress`, which issues a free permanent LUD-16
 * address off an `lnurlp` pay link. This one sells a verified name by the year
 * and it expires — the two look the same written down and behave nothing alike.
 */
export function useNip5() {
  const { user } = useCurrentUser();
  const { token, isConnected } = useLnbitsAuth();
  const { wallet, payInvoice, isPaying } = useLnbitsWallet();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const author = useAuthor(user?.pubkey);
  const metadata = author.data?.metadata;

  const addresses = useQuery<Nip5Address[]>({
    queryKey: ['nip5-addresses', NIP5_DOMAIN_ID, user?.pubkey ?? ''],
    queryFn: ({ signal }) =>
      withExtension(EXTENSION, token, () =>
        lnbitsRequest<Nip5Address[]>(`${BASE}/user/addresses`, {
          token,
          signal,
        })
      ),
    enabled: isNip5Configured() && isConnected,
    staleTime: 60 * 1000,
    retry: false,
  });

  // An account can hold names on several domains; only ours belong on this page
  const mine = (addresses.data ?? []).filter(
    (address) => address.domain_id === NIP5_DOMAIN_ID
  );

  const primary =
    mine.find((address) => address.active) ?? mine[0] ?? null;

  const identifier = primary ? formatNip5(primary.local_part) : null;

  const claim = useMutation<PendingNip5, Error, { localPart: string; years: number }>({
    mutationFn: async ({ localPart, years }) => {
      if (!user) throw new Error('Log in first');
      if (!isNip5Configured()) {
        throw new Error(
          'Verified names are not configured. Set VITE_NIP5_DOMAIN_ID.'
        );
      }

      const body = await withExtension(EXTENSION, token, () =>
        lnbitsRequest<unknown>(`${BASE}/user/domain/${NIP5_DOMAIN_ID}/address`, {
          method: 'POST',
          token,
          body: {
            domain_id: NIP5_DOMAIN_ID,
            local_part: localPart,
            // The name verifies this key, so it has to be the one signed in
            // here rather than whichever key the LNbits account was made with
            pubkey: user.pubkey,
            years,
            create_invoice: true,
          },
        })
      );

      return {
        address: readClaimedAddress(body),
        bolt11: readBolt11(body),
        paymentHash: readPaymentHash(body),
      };
    },
    onSuccess: (pending) => {
      queryClient.invalidateQueries({ queryKey: ['nip5-addresses'] });

      // A free name is live the moment it is created and needs no invoice
      if (!pending.bolt11) {
        toast({
          title: 'Name reserved',
          description: 'Publish it to your profile to finish.',
        });
      }
    },
    onError: (error: Error) => {
      const missing = isExtensionMissing(error);

      toast({
        title: missing ? 'Not available here' : 'Could not reserve that name',
        description: missing
          ? `${NIP5_DOMAIN} doesn't sell verified names — the nostrnip5 extension isn't installed.`
          : error.message,
        variant: 'destructive',
      });
    },
  });

  /** Pays a claim's invoice out of the user's own wallet. */
  const pay = useMutation({
    mutationFn: async (pending: PendingNip5) => {
      if (!pending.bolt11) throw new Error('Nothing to pay');
      if (!wallet) throw new Error('Connect your wallet first');

      await payInvoice(pending.bolt11);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nip5-addresses'] });
      queryClient.invalidateQueries({ queryKey: ['nip5-payment'] });
    },
  });

  /**
   * Points the name at the user's wallet, so it receives zaps too.
   *
   * Optional, and separate from buying it: a NIP-05 identifier verifies who
   * someone is, a lightning address takes money, and the extension will do
   * both under one name only if asked.
   */
  const attachLightning = useMutation({
    mutationFn: async (address: Nip5Address) => {
      if (!wallet) throw new Error('Connect your wallet first');

      await withExtension(EXTENSION, token, () =>
        lnbitsRequest(
          `${BASE}/user/domain/${NIP5_DOMAIN_ID}/address/${address.id}/lnaddress`,
          {
            method: 'PUT',
            token,
            body: { wallet: wallet.id, min: 1, max: 10_000_000 },
          }
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nip5-addresses'] });
      toast({
        title: 'Zaps enabled',
        description: 'That name now receives payments as well as verifying you.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not enable zaps for that name',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * Publishes the identifier as `nip05` in the profile.
   *
   * Until this happens no client shows the ✓ — verification is something
   * readers do against the profile, not something our server can assert.
   */
  const publishToProfile = useMutation({
    mutationFn: async () => {
      if (!identifier) throw new Error('No name to publish');
      if (!user) throw new Error('Log in first');

      /**
       * Kind 0 replaces rather than merges, so publishing before the existing
       * profile has arrived would wipe the name, picture and bio in the act of
       * adding one field.
       */
      if (author.isLoading || !author.isFetched) {
        throw new Error('Still reading your profile — try again in a moment.');
      }

      await createEvent({
        kind: 0,
        content: JSON.stringify({ ...(metadata ?? {}), nip05: identifier }),
        tags: [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['author', user?.pubkey] });
      toast({
        title: 'Profile updated',
        description: `You're ${identifier} on Nostr now.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not update your profile',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    isConfigured: isNip5Configured(),
    domain: NIP5_DOMAIN,
    addresses: mine,
    address: primary,
    identifier,
    /** Whether the profile already advertises it, which is what shows the ✓. */
    isOnProfile: !!identifier && metadata?.nip05 === identifier,
    profileIdentifier: metadata?.nip05,
    /**
     * Whether the name verifies the key signed in here. It can differ when the
     * LNbits account was reached with a password and made with another key.
     */
    matchesCurrentKey: !primary || !user || primary.pubkey === user.pubkey,
    isLoading: addresses.isLoading,
    /** The extension is absent on this instance, so nothing here will work. */
    isUnavailable: isExtensionMissing(addresses.error),
    claim: claim.mutateAsync,
    isClaiming: claim.isPending,
    pay: pay.mutateAsync,
    isPaying: isPaying || pay.isPending,
    attachLightning: attachLightning.mutateAsync,
    isAttaching: attachLightning.isPending,
    publishToProfile: publishToProfile.mutateAsync,
    isPublishing: publishToProfile.isPending,
    suggestedFrom: metadata?.name || metadata?.display_name || '',
  };
}
