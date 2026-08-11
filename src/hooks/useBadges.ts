import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  BADGE_AWARD_KIND,
  BADGE_DEFINITION_KIND,
  BADGE_SET_KIND,
  PROFILE_BADGES_KIND,
  buildProfileBadgeTags,
  isProfileBadges,
  parseBadgeAward,
  parseBadgeClaims,
  parseBadgeDefinition,
  verifyClaims,
  type BadgeAward,
  type BadgeDefinition,
  type DisplayBadge,
} from '@/lib/nip58';

/** Splits `30009:<pubkey>:<identifier>` for querying. */
function splitAddress(
  address: string
): { kind: number; pubkey: string; identifier: string } | null {
  const [kind, pubkey, ...rest] = address.split(':');
  const parsed = Number.parseInt(kind, 10);

  if (parsed !== BADGE_DEFINITION_KIND) return null;
  if (!/^[0-9a-f]{64}$/i.test(pubkey ?? '')) return null;

  return { kind: parsed, pubkey, identifier: rest.join(':') };
}

/**
 * The badges someone chose to show, verified.
 *
 * Three hops: the owner's list, the definitions it names, the awards it names.
 * Then everything is checked before any of it renders — see `verifyClaims`.
 * Reading awards directly instead would be one query shorter and would let
 * anybody put a badge on anybody's profile.
 */
export function useProfileBadges(pubkey: string | undefined) {
  const { nostr } = useNostr();

  const query = useQuery<DisplayBadge[]>({
    queryKey: ['profile-badges', pubkey ?? ''],
    queryFn: async ({ signal }) => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(5000)]);

      /**
       * Both the current kind and the superseded one, in a single filter.
       * Somebody who set their badges before the format changed should not
       * find their profile bare.
       */
      const lists = await nostr.query(
        [
          { kinds: [PROFILE_BADGES_KIND], authors: [pubkey!], limit: 1 },
          {
            kinds: [BADGE_SET_KIND],
            authors: [pubkey!],
            '#d': ['profile_badges'],
            limit: 1,
          },
        ],
        { signal: timeout }
      );

      const list = lists
        .filter(isProfileBadges)
        // The newer format wins when both exist, then the newer event
        .sort(
          (a, b) =>
            (b.kind === PROFILE_BADGES_KIND ? 1 : 0) -
              (a.kind === PROFILE_BADGES_KIND ? 1 : 0) ||
            b.created_at - a.created_at
        )[0];

      if (!list) return [];

      const claims = parseBadgeClaims(list);
      if (!claims.length) return [];

      const addresses = [...new Set(claims.map((claim) => claim.definitionAddress))];
      const awardIds = [...new Set(claims.map((claim) => claim.awardId))];

      const parsed = addresses
        .map(splitAddress)
        .filter((entry): entry is NonNullable<typeof entry> => !!entry);

      const [definitionEvents, awardEvents] = await Promise.all([
        parsed.length
          ? nostr.query(
              [
                {
                  kinds: [BADGE_DEFINITION_KIND],
                  authors: [...new Set(parsed.map((entry) => entry.pubkey))],
                  '#d': [...new Set(parsed.map((entry) => entry.identifier))],
                  limit: parsed.length * 4,
                },
              ],
              { signal: timeout }
            )
          : Promise.resolve([] as NostrEvent[]),
        nostr.query([{ ids: awardIds, limit: awardIds.length }], {
          signal: timeout,
        }),
      ]);

      const definitions = new Map<string, BadgeDefinition>();

      for (const event of definitionEvents.sort(
        (a, b) => a.created_at - b.created_at
      )) {
        const definition = parseBadgeDefinition(event);
        // Newest revision wins: definitions can be updated
        if (definition) definitions.set(definition.address, definition);
      }

      const awards = new Map<string, BadgeAward>();

      for (const event of awardEvents) {
        const award = parseBadgeAward(event);
        if (award) awards.set(event.id, award);
      }

      return verifyClaims(claims, pubkey!, definitions, awards);
    },
    enabled: !!pubkey,
    staleTime: 5 * 60_000,
  });

  return {
    badges: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/**
 * Badges awarded to the signed-in user that they have not accepted.
 *
 * The inbox side of the design. An award is somebody else's event naming you
 * and needs no permission, so this is a list of offers — nothing here appears
 * anywhere until it is accepted.
 */
export function useBadgeAwards() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { badges } = useProfileBadges(user?.pubkey);

  const accepted = new Set(badges.map((badge) => badge.definition.address));

  const query = useQuery<DisplayBadge[]>({
    queryKey: ['badge-awards', user?.pubkey ?? ''],
    queryFn: async ({ signal }) => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(5000)]);

      const awardEvents = await nostr.query(
        [{ kinds: [BADGE_AWARD_KIND], '#p': [user!.pubkey], limit: 100 }],
        { signal: timeout }
      );

      const awards = awardEvents
        .map(parseBadgeAward)
        .filter((award): award is BadgeAward => !!award)
        /**
         * A relay can serve awards whose `p` tags do not include the person
         * who asked. Checked rather than trusted, since the whole list is
         * built on the claim that these are yours.
         */
        .filter((award) => award.recipients.includes(user!.pubkey.toLowerCase()));

      if (!awards.length) return [];

      const parsed = [...new Set(awards.map((award) => award.definitionAddress))]
        .map(splitAddress)
        .filter((entry): entry is NonNullable<typeof entry> => !!entry);

      if (!parsed.length) return [];

      const definitionEvents = await nostr.query(
        [
          {
            kinds: [BADGE_DEFINITION_KIND],
            authors: [...new Set(parsed.map((entry) => entry.pubkey))],
            '#d': [...new Set(parsed.map((entry) => entry.identifier))],
            limit: parsed.length * 4,
          },
        ],
        { signal: timeout }
      );

      const definitions = new Map<string, BadgeDefinition>();

      for (const event of definitionEvents.sort(
        (a, b) => a.created_at - b.created_at
      )) {
        const definition = parseBadgeDefinition(event);
        if (definition) definitions.set(definition.address, definition);
      }

      const offers: DisplayBadge[] = [];
      const seen = new Set<string>();

      for (const award of awards.sort(
        (a, b) => b.event.created_at - a.event.created_at
      )) {
        const definition = definitions.get(award.definitionAddress);
        if (!definition || seen.has(definition.address)) continue;

        seen.add(definition.address);
        offers.push({ definition, award });
      }

      return offers;
    },
    enabled: !!user?.pubkey,
    staleTime: 5 * 60_000,
  });

  const offers = query.data ?? [];

  return {
    /** Everything awarded to this key, accepted or not. */
    awards: offers,
    /** Only what is not already on the profile. */
    pending: offers.filter((offer) => !accepted.has(offer.definition.address)),
    isLoading: query.isLoading,
  };
}

/** Choosing what appears, and in what order. */
export function useProfileBadgeActions() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { badges } = useProfileBadges(user?.pubkey);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const save = async (next: DisplayBadge[]) => {
    if (!user) throw new Error('Log in first');

    /**
     * Replaceable, so the event carries the whole list. Publishing only the
     * change would drop every other badge the person had accepted.
     */
    await createEvent({
      kind: PROFILE_BADGES_KIND,
      content: '',
      tags: buildProfileBadgeTags(next),
    });

    queryClient.invalidateQueries({ queryKey: ['profile-badges'] });
    queryClient.invalidateQueries({ queryKey: ['badge-awards'] });
  };

  const accept = useMutation({
    mutationFn: async (badge: DisplayBadge) => {
      const already = badges.some(
        (entry) => entry.definition.address === badge.definition.address
      );

      if (already) return;
      await save([...badges, badge]);
    },
    onSuccess: () => toast({ title: 'Added to your profile' }),
    onError: (error: Error) =>
      toast({
        title: 'Could not add that badge',
        description: error.message,
        variant: 'destructive',
      }),
  });

  const remove = useMutation({
    mutationFn: async (badge: DisplayBadge) =>
      await save(
        badges.filter(
          (entry) => entry.definition.address !== badge.definition.address
        )
      ),
    onSuccess: () =>
      toast({
        title: 'Removed from your profile',
        description: 'The award still exists — it just is not displayed.',
      }),
    onError: (error: Error) =>
      toast({
        title: 'Could not remove that badge',
        description: error.message,
        variant: 'destructive',
      }),
  });

  return {
    accept: accept.mutateAsync,
    isAccepting: accept.isPending,
    remove: remove.mutateAsync,
    isRemoving: remove.isPending,
  };
}
