import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { LnbitsError, lnbitsRequest } from '@/lib/lnbits';
import { buildPayLinkBody, formatAddress } from '@/lib/lightningAddress';

/** A pay link as returned by the lnurlp extension. */
export interface PayLink {
  id: string;
  wallet: string;
  description: string;
  username?: string;
  zaps?: boolean;
  disposable: boolean;
  min: number;
  max: number;
  comment_chars: number;
}

/**
 * The user's lightning address, backed by an LNbits pay link.
 *
 * Creating one needs the wallet's admin key, which we hold in memory from the
 * user's own session — it is their wallet, so there is no shared secret here
 * and nothing is written to storage.
 */
export function useLightningAddress() {
  const { user } = useCurrentUser();
  const { wallet } = useLnbitsWallet();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const author = useAuthor(user?.pubkey);
  const metadata = author.data?.metadata;

  const links = useQuery<PayLink[]>({
    queryKey: ['lnurlp-links', wallet?.id ?? ''],
    queryFn: ({ signal }) =>
      lnbitsRequest<PayLink[]>('/lnurlp/api/v1/links', {
        apiKey: wallet!.inkey,
        signal,
      }),
    enabled: !!wallet,
    staleTime: 60 * 1000,
    retry: false,
  });

  // A wallet can hold many pay links; the address is the one with a username
  const link = links.data?.find((entry) => entry.username) ?? null;
  const address = link?.username ? formatAddress(link.username) : null;

  const claim = useMutation({
    mutationFn: async (username: string) => {
      if (!wallet) throw new Error('Connect your wallet first');

      /**
       * An account that already has this address keeps it.
       *
       * People arrive here more than once — a second device, a reconnect, a
       * reload mid-flow. Creating another pay link each time would leave the
       * wallet with duplicates competing for the same name, and LNbits would
       * reject the second one anyway.
       */
      const existing = links.data?.find(
        (entry) => entry.username?.toLowerCase() === username.toLowerCase()
      );
      if (existing) return existing;

      const created = await lnbitsRequest<PayLink>('/lnurlp/api/v1/links', {
        method: 'POST',
        apiKey: wallet.adminkey,
        body: buildPayLinkBody({
          username,
          walletId: wallet.id,
          displayName: metadata?.display_name || metadata?.name,
        }),
      });

      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['lnurlp-links'] });
      toast({
        title: 'Lightning address created',
        description: created.username
          ? `${formatAddress(created.username)} is yours.`
          : 'Your address is ready.',
      });
    },
    onError: (error: Error) => {
      // A taken username is the common case and deserves plain wording
      const taken =
        error instanceof LnbitsError &&
        /exists|taken|already|duplicate/i.test(error.message);

      toast({
        title: taken ? 'That name is taken' : 'Could not create your address',
        description: taken ? 'Try a different one.' : error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * Publishes the address into the user's profile as `lud16`.
   *
   * Until this happens the address exists but nobody can zap them with it —
   * other clients read the zap target from kind 0 metadata, not from our
   * database. Creating the address without this step looks finished and isn't.
   */
  const publishToProfile = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('No address to publish');
      if (!user) throw new Error('Log in first');

      /**
       * Kind 0 replaces, it does not merge. Publishing before the existing
       * profile has arrived would replace a name, picture and bio with a
       * document containing only a lightning address — the profile would be
       * erased by the act of adding one field to it.
       */
      if (author.isLoading || !author.isFetched) {
        throw new Error('Still reading your profile — try again in a moment.');
      }

      await createEvent({
        kind: 0,
        content: JSON.stringify({ ...(metadata ?? {}), lud16: address }),
        tags: [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['author', user?.pubkey] });
      toast({
        title: 'Profile updated',
        description: 'Anyone on Nostr can zap you at this address now.',
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
    address,
    link,
    isLoading: links.isLoading,
    /** Whether the profile already advertises this address for zaps. */
    isOnProfile: !!address && metadata?.lud16 === address,
    profileAddress: metadata?.lud16,
    claim: claim.mutateAsync,
    isClaiming: claim.isPending,
    publishToProfile: publishToProfile.mutateAsync,
    isPublishing: publishToProfile.isPending,
    suggestedFrom: metadata?.name || metadata?.display_name || '',
  };
}
