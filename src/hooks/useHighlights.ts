import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrFilter } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  HIGHLIGHT_KIND,
  buildHighlightTags,
  highlightFilterFor,
  parseHighlight,
  type Highlight,
  type HighlightInput,
} from '@/lib/nip84';

export interface HighlightTarget {
  eventId?: string;
  address?: string;
  url?: string;
}

/** Everyone's highlights of one thing. */
export function useHighlights(target: HighlightTarget) {
  const { nostr } = useNostr();

  const key = [target.address ?? '', target.eventId ?? '', target.url ?? ''];
  const hasTarget = key.some(Boolean);

  return useQuery<Highlight[]>({
    queryKey: ['highlights', ...key],
    queryFn: async ({ signal }) => {
      /**
       * One query with several filters rather than one query each: an article
       * can be highlighted by coordinate, by event id and by its web URL, and
       * asking three times triples the load for an answer the relay can merge
       * itself.
       */
      const events = await nostr.query(
        highlightFilterFor(target) as NostrFilter[],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) }
      );

      const seen = new Set<string>();

      return events
        .sort((a, b) => b.created_at - a.created_at)
        .map(parseHighlight)
        .filter((highlight): highlight is Highlight => {
          if (!highlight || seen.has(highlight.event.id)) return false;
          seen.add(highlight.event.id);
          return true;
        });
    },
    enabled: hasTarget,
    staleTime: 2 * 60_000,
  });
}

/** Highlights somebody has made, for their profile. */
export function useHighlightsBy(pubkey: string | undefined, limit = 30) {
  const { nostr } = useNostr();

  return useQuery<Highlight[]>({
    queryKey: ['highlights-by', pubkey ?? '', limit],
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [{ kinds: [HIGHLIGHT_KIND], authors: [pubkey!], limit }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) }
      );

      return events
        .sort((a, b) => b.created_at - a.created_at)
        .map(parseHighlight)
        .filter((highlight): highlight is Highlight => !!highlight);
    },
    enabled: !!pubkey,
    staleTime: 5 * 60_000,
  });
}

/** Publishing a highlight, with or without a comment. */
export function useCreateHighlight() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: HighlightInput) => {
      if (!user) throw new Error('Log in first');

      const content = input.content.trim();

      /**
       * Empty content is legal — NIP-84 allows it for audio and video — but
       * only when there is media to point at. A highlight with no text and no
       * source is an event that says nothing about anything.
       */
      if (!content && !input.sourceEventId && !input.sourceAddress) {
        throw new Error('Select something to highlight first.');
      }

      return await createEvent({
        kind: HIGHLIGHT_KIND,
        content,
        tags: buildHighlightTags({ ...input, content }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['highlights'] });
      queryClient.invalidateQueries({ queryKey: ['highlights-by'] });
      toast({
        title: 'Highlighted',
        description: 'Anyone reading this can see what you picked out.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not publish that highlight',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
