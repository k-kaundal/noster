import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import type { Nip44Signer } from '@/lib/nip60';
import {
  ASSERTION_KINDS,
  TRUST_PROVIDERS_KIND,
  buildProviderTags,
  keysForKind,
  parseAssertion,
  parsePrivateProviders,
  parsePublicProviders,
  relaysForKind,
  type Assertion,
  type AssertionKind,
  type TrustProvider,
} from '@/lib/nip85';

/**
 * The reader's own declared providers, both halves.
 *
 * Everything downstream depends on this: an assertion is only worth reading if
 * one of these keys signed it. A reader who has declared nothing gets an empty
 * list and sees no scores at all, which is the correct outcome — this client
 * has no business picking a web-of-trust provider on somebody's behalf.
 */
export function useTrustProviders() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;

  const query = useQuery<TrustProvider[]>({
    queryKey: ['trust-providers', pubkey ?? ''],
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [{ kinds: [TRUST_PROVIDERS_KIND], authors: [pubkey!], limit: 1 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) }
      );

      const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!newest) return [];

      const providers = parsePublicProviders(newest);

      /**
       * The private half is optional and its failure is not an error: a
       * borrowed key cannot decrypt, and a signer that declines leaves the
       * public providers perfectly usable.
       */
      if (newest.content && user && !user.readOnly) {
        try {
          const signer = user.signer as Nip44Signer;
          const plaintext = await signer.nip44!.decrypt(
            user.pubkey,
            newest.content
          );

          providers.push(...parsePrivateProviders(plaintext));
        } catch {
          // Left with whatever was public
        }
      }

      return providers;
    },
    enabled: !!pubkey,
    staleTime: 10 * 60_000,
  });

  return {
    providers: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/**
 * Assertions about one subject, from declared keys only.
 *
 * The `authors` filter is the security boundary and is not optional: without
 * it this would return whatever anybody published about the subject, and a
 * stranger's invented rank would render exactly like a trusted one. Disabled
 * entirely when nothing is declared, so the failure mode is showing nothing
 * rather than showing anyone's claim.
 */
export function useAssertions(
  kind: AssertionKind | undefined,
  subject: string | undefined
) {
  const { nostr } = useNostr();
  const { providers } = useTrustProviders();

  const keys = kind ? keysForKind(providers, kind) : [];
  const hints = kind ? relaysForKind(providers, kind) : [];

  const query = useQuery<Assertion[]>({
    queryKey: ['assertions', kind ?? 0, subject ?? '', keys.join(',')],
    queryFn: async ({ signal }) => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(4000)]);
      const filter = { kinds: [kind!], authors: keys, '#d': [subject!], limit: 20 };

      /**
       * Asked of the relays the provider named, since assertion relays are
       * often not relays anyone reads for anything else — and providers "MAY
       * limit access to the results by using paid relays". Falls back to the
       * ordinary pool when no hint was given.
       */
      const source = hints.length ? nostr.group(hints) : nostr;

      const events = await source
        .query([filter], { signal: timeout })
        .catch(() => [] as never[]);

      return events
        .map(parseAssertion)
        .filter((assertion): assertion is Assertion => !!assertion);
    },
    enabled: !!kind && !!subject && keys.length > 0,
    staleTime: 5 * 60_000,
  });

  return {
    assertions: query.data ?? [],
    providers,
    isLoading: query.isLoading,
    /** False when the reader has declared no provider for this kind. */
    hasProviders: keys.length > 0,
  };
}

/** Declaring providers: replaces the whole kind 10040. */
export function useSetTrustProviders() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (providers: TrustProvider[]) => {
      if (!user) throw new Error('Log in first');

      const isPublic = providers.filter((provider) => !provider.isPrivate);
      const isSecret = providers.filter((provider) => provider.isPrivate);

      /**
       * The private half is JSON-stringified and NIP-44 encrypted to the
       * reader themselves. Which providers somebody trusts is a statement
       * about whose judgement they accept, and that is not obviously public
       * information — the spec offers the choice and this keeps it.
       */
      let content = '';

      if (isSecret.length) {
        const signer = user.signer as Nip44Signer;

        if (!signer.nip44) {
          throw new Error(
            'Your signer cannot encrypt, so private providers cannot be saved. Make them public or upgrade your signer.'
          );
        }

        content = await signer.nip44.encrypt(
          user.pubkey,
          JSON.stringify(buildProviderTags(isSecret))
        );
      }

      return await createEvent({
        kind: TRUST_PROVIDERS_KIND,
        content,
        tags: buildProviderTags(isPublic),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trust-providers'] });
      queryClient.invalidateQueries({ queryKey: ['assertions'] });
      toast({ title: 'Trusted providers updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not save that',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Providers the people you follow have declared.
 *
 * The discovery path from the NIP's appendix, minus its last step: it suggests
 * loading the OpenGraph tags of each provider's website, which a browser
 * cannot do across origins. The kind 0 of the service key carries a name, a
 * description and a picture, and those are shown instead — enough to choose
 * from without a server to proxy page fetches through.
 */
export function useDiscoverProviders() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { followingList } = useFollows(user?.pubkey ?? '');

  const authors = followingList.map((follow) => follow.pubkey).slice(0, 500);

  return useQuery({
    queryKey: ['discover-trust-providers', authors.length],
    queryFn: async ({ signal }) => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(6000)]);

      const events = await nostr.query(
        [{ kinds: [TRUST_PROVIDERS_KIND], authors, limit: 200 }],
        { signal: timeout }
      );

      /**
       * Only the public half of other people's declarations is readable, which
       * is the point of the encrypted half — nothing here tries to guess at
       * what somebody chose to keep private.
       */
      const declared = events.flatMap(parsePublicProviders);

      const byKey = new Map<string, { provider: TrustProvider; count: number }>();

      for (const provider of declared) {
        const existing = byKey.get(provider.pubkey);
        if (existing) existing.count += 1;
        else byKey.set(provider.pubkey, { provider, count: 1 });
      }

      return [...byKey.values()].sort((a, b) => b.count - a.count);
    },
    enabled: authors.length > 0,
    staleTime: 30 * 60_000,
  });
}

/** Every result type this client knows how to display, for the picker. */
export { ASSERTION_KINDS };
