import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { suggestUsername } from '@/lib/lightningAddress';

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
  const queryClient = useQueryClient();

  const author = useAuthor(user?.pubkey);
  const metadata = author.data?.metadata;

  const nip5 = useNip5();
  // The pay link that matches the bought name outranks any older one
  const lightning = useLightningAddress(
    localPartOf(nip5.identifier) ?? undefined
  );

  const status = describeIdentity({
    verifiedName: nip5.identifier,
    verifiedActive: nip5.address?.active,
    lightningAddress: lightning.address,
    profileNip05: metadata?.nip05,
    profileLud16: metadata?.lud16,
    // Every address of theirs, so a profile pointing at their own second one
    // is not mistaken for a profile pointing somewhere else entirely
    ownedAddresses: lightning.addresses.map((entry) => entry.address),
  });

  /**
   * A name to offer someone who has none.
   *
   * Their profile name if they have one; otherwise the name their key already
   * displays as, which is stable — a random suggestion that changes between
   * two looks at the same page reads as a bug.
   */
  const suggestion = suggestUsername(
    suggestIdentityName(
      metadata?.name || metadata?.display_name,
      user ? genUserName(user.pubkey) : ''
    )
  );

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
      queryClient.invalidateQueries({ queryKey: ['author', user?.pubkey] });
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

  return {
    status,
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
  };
}
