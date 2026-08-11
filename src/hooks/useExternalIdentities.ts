import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  IDENTITY_KIND,
  buildIdentityTags,
  readIdentityClaims,
  type IdentityClaim,
} from '@/lib/nip39';

/**
 * Someone's linked accounts, per NIP-39.
 *
 * Kind 10011 is replaceable, so there is exactly one of these per key and the
 * newest wins. That also means publishing replaces the whole list — adding one
 * account means sending every other one again, which is why the mutation below
 * takes the full set rather than a delta.
 */
export function useExternalIdentities(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['external-identities', pubkey ?? ''],
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [{ kinds: [IDENTITY_KIND], authors: [pubkey!], limit: 1 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) }
      );

      /**
       * Relays should return only the newest of a replaceable event, but they
       * are asked as a group and an older copy from one of them can arrive
       * after a newer copy from another.
       */
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0];

      return {
        event: newest ?? null,
        claims: readIdentityClaims(newest),
      };
    },
    enabled: !!pubkey,
    staleTime: 5 * 60_000,
  });
}

/** Reading and replacing the signed-in user's own claims. */
export function useMyExternalIdentities() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const identities = useExternalIdentities(user?.pubkey);

  const save = useMutation({
    mutationFn: async (claims: IdentityClaim[]) => {
      if (!user) throw new Error('Log in first');

      /**
       * Replaceable, so the event has to carry the whole list. Publishing only
       * the changed claim would silently drop every other account someone had
       * linked — the kind of loss that is noticed weeks later.
       */
      await createEvent({
        kind: IDENTITY_KIND,
        content: '',
        tags: buildIdentityTags(claims),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['external-identities', user?.pubkey ?? ''],
      });
      toast({ title: 'Linked accounts updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not update your linked accounts',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    claims: identities.data?.claims ?? [],
    isLoading: identities.isLoading,
    save: save.mutateAsync,
    isSaving: save.isPending,
  };
}
