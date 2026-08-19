import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useMuteList } from '@/hooks/useMuteList';
import { useToast } from '@/hooks/useToast';
import { filterMuted } from '@/lib/mute';
import { activityByCommunity } from '@/lib/communityStats';
import { buildCommentTags, targetFromEvent } from '@/lib/nip22';
import { extractMentionPubkeys, extractQuotedEvents } from '@/lib/mention';
import { hashtagTags, imetaTags, withAttachments } from '@/lib/attachments';
import {
  APPROVAL_KIND,
  COMMUNITY_KIND,
  approvedPostIds,
  buildCommunityTags,
  communityAddress,
  parseCommunity,
  type Community,
  type CommunityDraft,
} from '@/lib/community';

/** Keeps the newest definition per address, since these are replaceable. */
function latestPerAddress(events: NostrEvent[]): Community[] {
  const byAddress = new Map<string, Community>();

  for (const event of events) {
    const community = parseCommunity(event);
    if (!community) continue;

    const address = communityAddress(community);
    const existing = byAddress.get(address);

    if (!existing || existing.createdAt < community.createdAt) {
      byAddress.set(address, community);
    }
  }

  return [...byAddress.values()];
}

/** Communities to browse, newest first. */
export function useCommunities(limit = 50) {
  const { nostr } = useNostr();
  const { list: muteList } = useMuteList();

  const query = useQuery({
    queryKey: ['communities', limit],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);
      return nostr.query([{ kinds: [COMMUNITY_KIND], limit }], { signal });
    },
    staleTime: 5 * 60 * 1000,
  });

  const communities = useMemo(
    () =>
      latestPerAddress(filterMuted(query.data ?? [], muteList)).sort(
        (a, b) => b.createdAt - a.createdAt
      ),
    [query.data, muteList]
  );

  return { communities, isLoading: query.isLoading };
}

/** One community, addressed by its creator and slug. */
export function useCommunity(pubkey?: string, slug?: string) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['community', pubkey ?? '', slug ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      const events = await nostr.query(
        [{ kinds: [COMMUNITY_KIND], authors: [pubkey!], '#d': [slug!], limit: 5 }],
        { signal }
      );

      const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
      return newest ? parseCommunity(newest) : null;
    },
    enabled: !!pubkey && !!slug,
    staleTime: 5 * 60 * 1000,
  });

  return { community: query.data ?? null, isLoading: query.isLoading };
}

/**
 * Posts in a community, split by whether a moderator has approved them.
 *
 * NIP-72 makes approval the thing that decides membership: anyone can address
 * a post to a community, and it belongs there once a moderator says so. Both
 * sets are returned because a moderator needs to see the queue, and a reader
 * benefits from knowing the difference rather than being shown a mix.
 */
export function useCommunityPosts(community: Community | null) {
  const { nostr } = useNostr();
  const { list: muteList } = useMuteList();

  const address = community ? communityAddress(community) : '';

  const query = useQuery({
    queryKey: ['community-posts', address],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      // Posts and their approvals in one request rather than two round trips
      const events = await nostr.query(
        [
          { kinds: [1, 1111], '#a': [address], limit: 200 },
          { kinds: [APPROVAL_KIND], '#a': [address], limit: 200 },
        ],
        { signal }
      );

      return events;
    },
    enabled: !!address,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  return useMemo(() => {
    const events = filterMuted(query.data ?? [], muteList);

    const approvals = events.filter((event) => event.kind === APPROVAL_KIND);
    const posts = events
      .filter((event) => event.kind !== APPROVAL_KIND)
      .sort((a, b) => b.created_at - a.created_at);

    const approved = approvedPostIds(approvals, community?.moderators ?? []);

    return {
      approved: posts.filter((post) => approved.has(post.id)),
      pending: posts.filter((post) => !approved.has(post.id)),
      isLoading: query.isLoading,
      refetch: query.refetch,
    };
  }, [query.data, query.isLoading, query.refetch, muteList, community]);
}

/**
 * How busy each community on a page is, in one request for all of them.
 *
 * A directory card could state only when a community was *created*, which is
 * the least useful fact about a message board: a place started three years ago
 * and posted to yesterday reads identically to one started last week and
 * abandoned. Somebody browsing wants to know whether anyone is there.
 *
 * One query rather than one per card, which is what makes it affordable. An
 * approval carries the community in an `a` tag, so a single filter naming every
 * address on the page answers for the whole page — see `activityByCommunity`.
 */
export function useCommunityActivity(communities: readonly Community[]) {
  const { nostr } = useNostr();

  const addresses = useMemo(
    () => communities.map(communityAddress).sort(),
    [communities]
  );

  const query = useQuery({
    queryKey: ['community-activity', addresses.join(',')],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      return nostr.query(
        [{ kinds: [APPROVAL_KIND], '#a': addresses, limit: 1000 }],
        { signal }
      );
    },
    enabled: addresses.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(
    () => activityByCommunity(query.data ?? []),
    [query.data]
  );
}

/** Creating or editing a community definition. */
export function usePublishCommunity() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const publish = useMutation({
    mutationFn: async (draft: CommunityDraft) => {
      if (!user) throw new Error('Log in to create a community');
      if (!draft.name.trim()) throw new Error('Give it a name');

      await createEvent({
        kind: COMMUNITY_KIND,
        content: '',
        tags: buildCommunityTags(draft),
      });

      return nip19.naddrEncode({
        kind: COMMUNITY_KIND,
        pubkey: user.pubkey,
        identifier: draft.slug,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      queryClient.invalidateQueries({ queryKey: ['community'] });
      toast({ title: 'Community saved' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not save the community',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return { publish: publish.mutateAsync, isPublishing: publish.isPending };
}

/**
 * Approving a post into a community.
 *
 * The approval repeats the whole post as JSON, per NIP-72, so a client that
 * has the approval can render the post without going back for it — and so the
 * post survives in the community even if its author later deletes it from the
 * relays it was published to.
 */
export function useApprovePost(community: Community | null) {
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const approve = useMutation({
    mutationFn: async (post: NostrEvent) => {
      if (!community) throw new Error('No community');

      await createEvent({
        kind: APPROVAL_KIND,
        content: JSON.stringify(post),
        tags: [
          ['a', communityAddress(community)],
          ['e', post.id],
          ['p', post.pubkey],
          ['k', String(post.kind)],
        ],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
      toast({ title: 'Post approved' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not approve it',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return { approve: approve.mutateAsync, isApproving: approve.isPending };
}

/** Posting into a community, which starts as a request for approval. */
export function usePostToCommunity(community: Community | null) {
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const post = useMutation({
    mutationFn: async ({
      content,
      images = [],
    }: {
      content: string;
      /** Uploaded picture URLs, appended to the body and described in tags. */
      images?: string[];
    }) => {
      if (!community) throw new Error('No community');
      if (!content.trim() && !images.length) {
        throw new Error('Write something first');
      }

      /*
       * The pictures go in the body as well as the tags. `imeta` describes an
       * image, it does not place one — a post whose pictures live only in tags
       * reads as text in every other client.
       */
      const body = withAttachments(content, images);

      /**
       * A NIP-72 post is a NIP-22 comment scoped to the community, and this
       * used to emit half the tags it needs: a lowercase `a` for the parent,
       * uppercase `K` and `P` for the root, and nothing else. Missing `A`
       * meant no other client could find these posts — everyone queries the
       * uppercase root scope — and missing `k` broke a MUST outright.
       */
      await createEvent({
        kind: 1111,
        content: body,
        tags: [
          ...buildCommentTags({
            root: targetFromEvent(community.event),
            mentions: extractMentionPubkeys(body, nip19.decode),
            quotes: extractQuotedEvents(body, nip19.decode),
          }),
          /*
           * Hashtags were typed and thrown away here. A `#` in a community
           * post looked like a tag, read like a tag, and indexed as nothing —
           * so the post was unfindable by the subject its author gave it.
           */
          ...hashtagTags(body),
          ...imetaTags(images),
        ],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
      toast({
        title: 'Posted',
        description: 'A moderator has to approve it before it appears.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not post',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return { post: post.mutateAsync, isPosting: post.isPending };
}
