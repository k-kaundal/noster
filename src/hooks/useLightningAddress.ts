import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useLnbitsAuth } from '@/hooks/useLnbitsAuth';
import { useLnbitsWallet } from '@/hooks/useLnbitsWallet';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { LnbitsError, lnbitsRequest, withExtension } from '@/lib/lnbits';
import {
  buildPayLinkBody,
  buildZapsUpdateBody,
  linkAddress,
  payLinkPublishesZaps,
  readNameTaken,
  wellKnownUrl,
} from '@/lib/lightningAddress';
import { listAddresses, pickPrimaryLink } from '@/lib/identity';
import { generateFreeName, mayClaim } from '@/lib/freeAddress';

/** A pay link as returned by the lnurlp extension. */
export interface PayLink {
  id: string;
  wallet: string;
  description: string;
  username?: string;
  /**
   * Which domain this one answers under.
   *
   * Absent on an instance serving a single domain, and on every link made
   * before one was chosen — so it is read as "the default", never assumed to
   * be present.
   */
  domain?: string | null;
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
  const { wallet, wallets } = useLnbitsWallet();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const author = useAuthor(user?.pubkey);
  const metadata = author.data?.metadata;

  /**
   * Every pay link on the account, not only the active wallet's.
   *
   * An LNbits account can hold several wallets and an address belongs to a
   * wallet, so reading one wallet's links means somebody who switches wallets
   * watches half their addresses disappear — and a name they handed out looks
   * like it was never created. `all_wallets` is LNbits' own answer to that:
   * the key still authenticates one wallet, and the extension expands the
   * query to every wallet its owner has.
   *
   * Harmless on an instance that does not support the parameter, which ignores
   * it and answers with the active wallet's links exactly as before.
   */
  const links = useQuery<PayLink[]>({
    queryKey: ['lnurlp-links', wallet?.id ?? ''],
    queryFn: ({ signal }) =>
      withExtension('lnurlp', token, () =>
        lnbitsRequest<PayLink[]>('/lnurlp/api/v1/links?all_wallets=true', {
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
  const link = useMemo(
    () => pickPrimaryLink(links.data ?? [], preferredUsername),
    [links.data, preferredUsername]
  );
  const address = link ? linkAddress(link) : null;

  /**
   * All of them, not just the winner.
   *
   * Every pay link on the wallet still receives — retiring a name is a
   * deliberate act, not something claiming a new one does for you — so the
   * list is what someone needs to see to know where their money can arrive.
   */
  const addresses = useMemo(
    () =>
      listAddresses(links.data ?? [], {
        format: (entry) => linkAddress(entry) ?? '',
        profileLud16: metadata?.lud16,
        preferredUsername,
      }),
    [links.data, metadata?.lud16, preferredUsername]
  );

  const claim = useMutation({
    mutationFn: async (input: string | { username: string; domain?: string }) => {
      const { username, domain } =
        typeof input === 'string' ? { username: input, domain: undefined } : input;

      if (!wallet) throw new Error('Connect your wallet first');

      /**
       * Nothing below is decidable until the account's existing links are in
       * hand, and both things below read them.
       *
       * The dedupe returns the link somebody already has, and the entitlement
       * check treats what they already hold as theirs. With `links.data` still
       * undefined — a fresh load, a reconnect, the first render after
       * switching wallets — the dedupe finds nothing and the entitlement list
       * is empty, so re-claiming a name they bought last year is refused with
       * "That name has to be bought". They own it; the app simply had not
       * finished asking yet.
       *
       * An outright failure is refused rather than waved through. Not knowing
       * which addresses exist is not the same as knowing there are none, and
       * the alternative reading hands the paid tier to anyone whose request to
       * list them happens to fail.
       */
      if (!links.isFetched) {
        throw new Error('Still reading your addresses — try again in a moment.');
      }
      if (links.isError) {
        throw new Error(
          "Couldn't check which addresses you already have. Try again in a moment."
        );
      }

      /**
       * An account that already has this address keeps it.
       *
       * People arrive here more than once — a second device, a reconnect, a
       * reload mid-flow. Creating another pay link each time would leave the
       * wallet with duplicates competing for the same name, and LNbits would
       * reject the second one anyway.
       */
      /**
       * Matched on the name alone, because that is all the instance matches on.
       *
       * This compared the domain too, on the reasonable-sounding theory that
       * the same name under two domains is two addresses. It is not one here:
       * `GET /lnurlp/api/v1/well-known/{username}` takes no domain, so a link
       * named `alice` already answers for `alice@` everywhere this instance
       * serves. Asking for the second domain therefore tried to create a
       * duplicate, and `lnurlp` refused it with a 409 — the same conflict that
       * reaches the NIP-05 side as a bare 500.
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

      /**
       * Somebody else's, checked before creating rather than after.
       *
       * Everything above only knows about this account's own links, and the
       * namespace is the whole instance — so a name held by another user is
       * invisible here and collides all the same. `lnurlp` answers that with a
       * 409 and no explanation worth showing, so it is asked first, of the
       * public resolver that decides it. A lookup that fails to answer is not
       * treated as taken: refusing a name because a network call wobbled is
       * worse than letting the server have the final say.
       */
      const held = await fetch(wellKnownUrl(username), {
        signal: AbortSignal.timeout(6000),
      })
        .then((response) => response.json())
        .then(readNameTaken)
        .catch(() => false);

      if (held) {
        throw new Error(
          'That name is already taken here. Try a different one.'
        );
      }

      const created = await withExtension('lnurlp', token, () =>
        lnbitsRequest<PayLink>('/lnurlp/api/v1/links', {
          method: 'POST',
          apiKey: wallet.adminkey,
          body: buildPayLinkBody({
            username,
            domain,
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
        description: linkAddress(created)
          ? `${linkAddress(created)} is yours.`
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
   * Addresses that take payments but publish no zap receipt.
   *
   * The failure with no symptom at the wallet: sats arrive exactly as they
   * should, and nothing anywhere on Nostr ever shows a zap — not the count on
   * a post, not a fundraising goal's total — because all of those are counted
   * from receipts and no receipt is written. See `payLinkPublishesZaps`.
   */
  const silentAddresses = useMemo(
    () => (links.data ?? []).filter((entry) => !payLinkPublishesZaps(entry)),
    [links.data]
  );

  const enableZaps = useMutation({
    mutationFn: async (chosen?: PayLink) => {
      if (!wallet) throw new Error('Connect your wallet first');

      const targets = chosen ? [chosen] : silentAddresses;
      if (!targets.length) return;

      for (const entry of targets) {
        await withExtension('lnurlp', token, () =>
          lnbitsRequest<PayLink>(`/lnurlp/api/v1/links/${entry.id}`, {
            method: 'PUT',
            apiKey: wallet.adminkey,
            body: buildZapsUpdateBody(entry),
          })
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lnurlp-links'] });
      toast({
        title: 'Zaps switched on',
        description: 'New zaps to this address will show up on Nostr.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not switch zaps on',
        description: error.message,
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

  /**
   * Stable across renders that changed nothing.
   *
   * This hook is read by the wallet page, the composer, the profile and
   * `useIdentity`, and it hands back two computed arrays and two closures. A
   * fresh identity for any of them re-renders all of those and re-subscribes
   * whatever queries they own — which, for a query that is failing and so has
   * no data to go stale, means another request each time round.
   */
  const setProfileAddress = publishToProfile.mutateAsync;

  const walletNames = useMemo(
    () => Object.fromEntries(wallets.map((entry) => [entry.id, entry.name])),
    [wallets]
  );

  return useMemo(() => ({
    address,
    link,
    /** Every address on the account, not only the active wallet's. */
    addresses,
    /** Wallet id to name, so an address can say what it pays into. */
    walletNames,
    isLoading: links.isLoading,
    /**
     * Addresses that receive money but produce no zap receipt, so nothing
     * they are paid ever appears as a zap anywhere.
     */
    silentAddresses,
    enableZaps: enableZaps.mutateAsync,
    isEnablingZaps: enableZaps.isPending,
    /** Whether the profile already advertises this address for zaps. */
    isOnProfile: !!address && metadata?.lud16 === address,
    profileAddress: metadata?.lud16,
    claim: claim.mutateAsync,
    isClaiming: claim.isPending,
    /** Publishes the primary address; `setProfileAddress` picks another. */
    publishToProfile: () => setProfileAddress(undefined),
    setProfileAddress,
    isPublishing: publishToProfile.isPending,
    suggestedFrom: metadata?.name || metadata?.display_name || '',
  }), [
    address,
    link,
    addresses,
    walletNames,
    links.isLoading,
    silentAddresses,
    enableZaps.mutateAsync,
    enableZaps.isPending,
    metadata?.lud16,
    metadata?.name,
    metadata?.display_name,
    claim.mutateAsync,
    claim.isPending,
    setProfileAddress,
    publishToProfile.isPending,
  ]);
}
