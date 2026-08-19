import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLightningAddress } from '@/hooks/useLightningAddress';
import { useNip5 } from '@/hooks/useNip5';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import {
  describeIdentity,
  localPartOf,
  suggestIdentityName,
  withIdentity,
} from '@/lib/identity';
import {
  FREE_ADDRESS_DOMAIN,
  isFreeAddressDomain,
  normalizeDomain,
  suggestUsername,
} from '@/lib/lightningAddress';
import { generateFreeName, hasChosenName } from '@/lib/freeAddress';

/**
 * Someone's name here, both halves of it.
 *
 * The wallet page used to show a lightning address and a name reservation as
 * two unrelated cards. They are one thing at two tiers: a free address that
 * takes money, and a paid name that also proves who you are. This composes the
 * two hooks behind them so the page can talk about the result rather than the
 * plumbing.
 */
export function useIdentity() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();

  const author = useAuthor(user?.pubkey);
  const metadata = author.data?.metadata;

  const nip5 = useNip5();

  /**
   * Only live names. A reservation is created before its invoice is paid, and
   * an unpaid one must not entitle anybody to the address that goes with it —
   * that is the thing being sold.
   *
   * Memoised because it is an argument to another hook. A fresh array on every
   * render is a fresh argument, and a hook that treats its arguments as inputs
   * has to assume they changed.
   */
  const paidNames = useMemo(
    () =>
      nip5.addresses
        .filter((address) => address.active)
        .map((address) => address.local_part),
    [nip5.addresses]
  );

  const lightning = useLightningAddress({
    // The pay link that matches the bought name outranks any older one
    preferredUsername: localPartOf(nip5.identifier) ?? undefined,
    paidNames,
  });

  /**
   * Every address of theirs, so a profile pointing at their own second one is
   * not mistaken for a profile pointing somewhere else entirely.
   *
   * Only what this app issued. Addresses at the other services we run are
   * recognised by their domain inside `describeIdentity`, which is the same
   * answer without a request — this hook is read by the composer and the
   * profile, and it should not put either of them on the network to find out
   * whether to show a nag.
   */
  const ownedAddresses = useMemo(
    () => lightning.addresses.map((entry) => entry.address),
    [lightning.addresses]
  );

  const status = useMemo(
    () =>
      describeIdentity({
        verifiedName: nip5.identifier,
        verifiedActive: nip5.address?.active,
        lightningAddress: lightning.address,
        profileNip05: metadata?.nip05,
        profileLud16: metadata?.lud16,
        ownedAddresses,
      }),
    [
      nip5.identifier,
      nip5.address?.active,
      lightning.address,
      metadata?.nip05,
      metadata?.lud16,
      ownedAddresses,
    ]
  );

  /**
   * A name to offer someone who has none.
   *
   * Their profile name if they have one; otherwise the name their key already
   * displays as, which is stable — a random suggestion that changes between
   * two looks at the same page reads as a bug.
   *
   * Only reachable through the paid flow now: a chosen name is what is being
   * sold. This is the value that pre-fills that form.
   */
  const suggestion = suggestUsername(
    suggestIdentityName(
      metadata?.name || metadata?.display_name,
      user ? genUserName(user.pubkey) : ''
    )
  );

  /**
   * The address given away.
   *
   * Assigned from the key rather than chosen, which is the whole difference
   * between the tiers: it receives zaps exactly as well as a bought name and
   * says nothing about who owns it.
   */
  const freeName = user ? generateFreeName(user.pubkey) : '';

  /** Whether they are still on the assigned name, and so have an upgrade to buy. */
  const onFreeName = !!lightning.link?.username && !hasChosenName(lightning.link.username);

  /**
   * Claims the free address.
   *
   * Takes no name, because there is none to take — the name comes from the
   * key. It does take a domain, when the instance serves more than one, and
   * that is the only part of the pair somebody chooses here.
   *
   * Idempotent per domain: pressing it twice for the same one returns the pay
   * link that already exists rather than making a second.
   */
  const claimFree = useMutation({
    mutationFn: async (domain?: string) => {
      if (!freeName) throw new Error('Log in first');

      /**
       * Pinned to a domain that actually gives names away.
       *
       * Not `ADDRESS_DOMAIN`: that is whichever domain happens to be listed
       * first, and on a deployment that also sells a premium one it is the
       * premium one — so the free button was handing out paid inventory. A
       * domain outside the free list is corrected rather than refused, because
       * the only caller is a picker that offers free domains and nothing else,
       * which makes anything else a bug here rather than a choice made there.
       */
      const target =
        domain && isFreeAddressDomain(domain)
          ? normalizeDomain(domain)
          : FREE_ADDRESS_DOMAIN;

      return await lightning.claim({ username: freeName, domain: target });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not set up your address',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * Writes both fields into the profile in one event.
   *
   * Kind 0 replaces rather than merges, so this needs the existing profile in
   * hand — publishing before it has loaded would replace a name, picture and
   * bio with a document containing only an address.
   */
  const publish = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Log in first');
      if (!status.primary) throw new Error('Nothing to publish yet');

      if (author.isLoading || !author.isFetched) {
        throw new Error('Still reading your profile — try again in a moment.');
      }

      await createEvent({
        kind: 0,
        content: JSON.stringify(
          withIdentity(metadata ?? {}, {
            // Only a live name goes in nip05; an unpaid one would fail to
            // verify and show a broken checkmark on every note
            nip05: status.tier === 'verified' ? nip5.identifier : undefined,
            lud16: lightning.address,
          })
        ),
        tags: [],
      });
    },
    onSuccess: () => {
      /*
       * Not invalidated, for the reason set out in `useAuthor`: publishing has
       * already seeded the signed event, and asking the relays now only gets
       * back the profile from before this edit, because they have not indexed
       * it yet. `reconcileAuthor` refuses the stale answer either way, but
       * spending a request to be told something older is still a waste.
       */
      toast({
        title: 'Profile updated',
        description:
          status.tier === 'verified'
            ? `You're ${nip5.identifier} on Nostr now, and zaps land here.`
            : 'Anyone on Nostr can zap you at this address now.',
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
   * Moves the lightning address onto the verified name.
   *
   * Someone who claimed a free address before buying a name has zaps still
   * arriving at the old one. This issues a pay link at the new name so the two
   * halves agree; the old link keeps working, since money already in flight to
   * it should not bounce.
   */
  const alignLightningAddress = useMutation({
    mutationFn: async () => {
      const wanted = localPartOf(nip5.identifier);
      if (!wanted) throw new Error('Reserve a name first');

      await lightning.claim(wanted);
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not move your lightning address',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return useMemo(() => ({
    status,
    /** The name assigned to this key, free and unchosen. */
    freeName,
    /** True while they hold only the assigned name — the upgrade applies. */
    onFreeName,
    claimFree: claimFree.mutateAsync,
    isClaimingFree: claimFree.isPending,
    /** The verified half. */
    nip5,
    /** The free half. */
    lightning,
    suggestion,
    isLoading: lightning.isLoading || nip5.isLoading,
    publish: publish.mutateAsync,
    isPublishing: publish.isPending,
    alignLightningAddress: alignLightningAddress.mutateAsync,
    isAligning: alignLightningAddress.isPending,
  }), [
    status,
    freeName,
    onFreeName,
    claimFree.mutateAsync,
    claimFree.isPending,
    nip5,
    lightning,
    suggestion,
    publish.mutateAsync,
    publish.isPending,
    alignLightningAddress.mutateAsync,
    alignLightningAddress.isPending,
  ]);
}
