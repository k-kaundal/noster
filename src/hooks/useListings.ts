import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMuteList } from '@/hooks/useMuteList';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { filterMuted } from '@/lib/mute';
import {
  LISTING_DRAFT_KIND,
  LISTING_KIND,
  buildListingTags,
  parseListing,
  type Listing,
  type ListingInput,
} from '@/lib/nip99';

/**
 * One revision per address.
 *
 * Addressable events are replaced rather than superseded, but relays hold
 * older revisions and hand several back — and for a listing the difference is
 * the price. Showing a stale revision quotes a figure the seller has already
 * changed.
 */
function latestPerAddress(events: NostrEvent[]): Listing[] {
  const byAddress = new Map<string, Listing>();

  for (const event of events) {
    const listing = parseListing(event);
    if (!listing) continue;

    const address = `${event.kind}:${event.pubkey}:${listing.slug}`;
    const existing = byAddress.get(address);

    if (!existing || existing.updatedAt < listing.updatedAt) {
      byAddress.set(address, listing);
    }
  }

  return [...byAddress.values()].sort((a, b) => b.publishedAt - a.publishedAt);
}

interface ListingQuery {
  author?: string;
  hashtag?: string;
  /** Include listings marked sold. Off by default — they cannot be bought. */
  includeSold?: boolean;
  limit?: number;
}

/** Published listings. */
export function useListings({
  author,
  hashtag,
  includeSold = false,
  limit = 40,
}: ListingQuery = {}) {
  const { nostr } = useNostr();
  const { list: muteList } = useMuteList();

  const query = useQuery({
    queryKey: ['listings', author ?? '', hashtag ?? '', includeSold, limit],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      const events = await nostr.query(
        [
          {
            kinds: [LISTING_KIND],
            ...(author ? { authors: [author] } : {}),
            ...(hashtag ? { '#t': [hashtag.toLowerCase()] } : {}),
            limit,
          },
        ],
        { signal }
      );

      const listings = latestPerAddress(filterMuted(events, muteList));

      return includeSold
        ? listings
        : listings.filter((listing) => listing.status !== 'sold');
    },
  });

  return {
    listings: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/** One listing by address. */
export function useListing(
  pubkey: string | undefined,
  slug: string | undefined,
  kind: number = LISTING_KIND
) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['listing', kind, pubkey ?? '', slug ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [{ kinds: [kind], authors: [pubkey!], '#d': [slug!], limit: 5 }],
        { signal }
      );

      return latestPerAddress(events)[0] ?? null;
    },
    enabled: !!pubkey && !!slug,
  });

  return {
    listing: query.data ?? null,
    isLoading: query.isLoading,
  };
}

/**
 * The signed-in user's own listings, drafts included.
 *
 * Both kinds in one query. A seller's own page is the only place a kind 30403
 * belongs — it is either unpublished or withdrawn, and in both cases it is
 * theirs to see and nobody else's.
 */
export function useMyListings() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const query = useQuery({
    queryKey: ['my-listings', user?.pubkey ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      const events = await nostr.query(
        [
          {
            kinds: [LISTING_KIND, LISTING_DRAFT_KIND],
            authors: [user!.pubkey],
            limit: 100,
          },
        ],
        { signal }
      );

      return latestPerAddress(events);
    },
    enabled: !!user?.pubkey,
  });

  return {
    listings: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/** Publishing, editing, and taking a listing down. */
export function useListingActions() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['listings'] });
    queryClient.invalidateQueries({ queryKey: ['listing'] });
    queryClient.invalidateQueries({ queryKey: ['my-listings'] });
  };

  const publish = useMutation({
    mutationFn: async ({
      input,
      asDraft = false,
    }: {
      input: ListingInput;
      asDraft?: boolean;
    }) => {
      if (!user) throw new Error('Log in first');
      if (!input.title.trim()) throw new Error('Give the listing a title.');

      return await createEvent({
        kind: asDraft ? LISTING_DRAFT_KIND : LISTING_KIND,
        content: input.content,
        tags: buildListingTags(input),
      });
    },
    onSuccess: (_event, variables) => {
      refresh();
      toast({
        title: variables.asDraft ? 'Draft saved' : 'Listing published',
        description: variables.asDraft
          ? 'Only you can see it until you publish.'
          : 'Anyone browsing the market can see it now.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not save that listing',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  /**
   * Marks a listing sold.
   *
   * Republished with `status: sold` rather than deleted. A sold listing is
   * still a record of a sale that happened, and a buyer who bookmarked it
   * should find out it is gone rather than find nothing at all.
   */
  const markSold = useMutation({
    mutationFn: async (listing: Listing) => {
      if (!user) throw new Error('Log in first');

      return await createEvent({
        kind: LISTING_KIND,
        content: listing.content,
        tags: buildListingTags({
          slug: listing.slug,
          title: listing.title,
          summary: listing.summary,
          content: listing.content,
          price: listing.price,
          location: listing.location,
          geohash: listing.geohash,
          images: listing.images,
          hashtags: listing.hashtags,
          status: 'sold',
          // Kept, so marking it sold does not reset when it was first listed
          publishedAt: listing.publishedAt,
        }),
      });
    },
    onSuccess: () => {
      refresh();
      toast({ title: 'Marked as sold' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not update that listing',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    publish: publish.mutateAsync,
    isPublishing: publish.isPending,
    markSold: markSold.mutateAsync,
    isMarkingSold: markSold.isPending,
  };
}
