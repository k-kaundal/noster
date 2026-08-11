import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { LnbitsError, lnbitsRequest, withExtension } from '@/lib/lnbits';
import { buildPayLinkBody, formatAddress } from '@/lib/lightningAddress';
import { listAddresses, pickPrimaryLink } from '@/lib/identity';
import { generateFreeName, mayClaim } from '@/lib/freeAddress';

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

export interface LightningAddressOptions {
  /**
   * The bought name, used to rank which pay link counts as primary. Passed
   * even while the purchase is unpaid, since ranking is only about display.
   */
  preferredUsername?: string;
  /**
   * Names this person has actually paid for and which are live.
   *
   * Kept separate from `preferredUsername` on purpose. A reservation exists
   * from the moment somebody types a name, before any invoice is settled, and
   * `useNip5` falls back to showing an inactive one — so treating "the name
   * being displayed" as "a name they bought" would hand out the paid tier to
   * anyone who started the checkout and closed the tab.
   */
  paidNames?: string[];
}

/**
 * The user's lightning address, backed by an LNbits pay link.
 *
 * Creating one needs the wallet's admin key, which we hold in memory from the
 * user's own session — it is their wallet, so there is no shared secret here
 * and nothing is written to storage.
 */
export function useLightningAddress({
  preferredUsername,
  paidNames = [],
}: LightningAddressOptions = {}) {
  const { user } = useCurrentUser();
  const { token } = useLnbitsAuth();
  const { wallet } = useLnbitsWallet();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const author = useAuthor(user?.pubkey);
  const metadata = author.data?.metadata;

  const links = useQuery<PayLink[]>({
    queryKey: ['lnurlp-links', wallet?.id ?? ''],
    queryFn: ({ signal }) =>
      withExtension('lnurlp', token, () =>
        lnbitsRequest<PayLink[]>('/lnurlp/api/v1/links', {
          apiKey: wallet!.inkey,
          signal,
        })
      ),
    enabled: !!wallet,
    staleTime: 60 * 1000,
    retry: false,
  });

  /**
   * A wallet accumulates one pay link per name ever claimed, so "the first one
   * with a username" would let an abandoned name outrank the one just bought.
   * The verified name wins when there is a link for it.
   */
  const link = pickPrimaryLink(links.data ?? [], preferredUsername);
  const address = link?.username ? formatAddress(link.username) : null;

  /**
   * All of them, not just the winner.
   *
   * Every pay link on the wallet still receives — retiring a name is a
   * deliberate act, not something claiming a new one does for you — so the
   * list is what someone needs to see to know where their money can arrive.
   */
  const addresses = listAddresses(links.data ?? [], {
    format: formatAddress,
    profileLud16: metadata?.lud16,
    preferredUsername,
  });

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

      /**
       * Which names this person is entitled to, checked here rather than only
       * where the buttons are. A chosen name is the thing being sold, and this
       * function is what every path to a new address goes through.
       */
      if (
        !mayClaim(username, {
          freeName: user ? generateFreeName(user.pubkey) : '',
          paidNames,
          ownedNames: (links.data ?? []).map((entry) => entry.username),
        })
      ) {
        throw new Error(
          'That name has to be bought. Reserve it as a verified name and the matching address comes with it.'
        );
      }

      const created = await withExtension('lnurlp', token, () =>
        lnbitsRequest<PayLink>('/lnurlp/api/v1/links', {
          method: 'POST',
          apiKey: wallet.adminkey,
          body: buildPayLinkBody({
            username,
            walletId: wallet.id,
            displayName: metadata?.display_name || metadata?.name,
          }),
        })
      );

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

  /* There is deliberately no way to delete an address.
   *
   * `DELETE /lnurlp/api/v1/links/{id}` does not merely stop a name resolving —
   * it returns the name to the pool, and the next person to claim it starts
   * receiving the money aimed at the person who gave it out. Nostr profiles,
   * saved contacts and printed QR codes all outlive the pay link, and none of
   * them find out. The failure is silent and it moves somebody's money to a
   * stranger, which is not a thing worth a confirm dialog.
   *
   * So a name, once issued, stays issued. Stopping payments is a separate and
   * reversible act: publish a different address and zaps stop arriving here.
   * The old one keeps working for whoever already had it, which is what the
   * person handing it out was entitled to assume.
   */

  /**
   * Publishes an address into the user's profile as `lud16`.
   *
   * Until this happens the address exists but nobody can zap them with it —
   * other clients read the zap target from kind 0 metadata, not from our
   * database. Creating the address without this step looks finished and isn't.
   *
   * Takes which address to publish, because a wallet can have several and the
   * one someone wants zaps at is not always the one this hook would pick.
   */
  const publishToProfile = useMutation({
    mutationFn: async (chosen: string | undefined) => {
      const target = chosen ?? address;

      if (!target) throw new Error('No address to publish');
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
        content: JSON.stringify({ ...(metadata ?? {}), lud16: target }),
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
    /** Every address on this wallet, not only the one shown as primary. */
    addresses,
    isLoading: links.isLoading,
    /** Whether the profile already advertises this address for zaps. */
    isOnProfile: !!address && metadata?.lud16 === address,
    profileAddress: metadata?.lud16,
    claim: claim.mutateAsync,
    isClaiming: claim.isPending,
    /** Publishes the primary address; `setProfileAddress` picks another. */
    publishToProfile: () => publishToProfile.mutateAsync(undefined),
    setProfileAddress: (chosen: string) =>
      publishToProfile.mutateAsync(chosen),
    isPublishing: publishToProfile.isPending,
    suggestedFrom: metadata?.name || metadata?.display_name || '',
  };
}
