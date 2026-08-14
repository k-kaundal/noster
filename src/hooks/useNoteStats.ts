import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { createBatchLoader, type BatchLoader } from '@/lib/batchLoader';
import { getThreadPosition } from '@/lib/thread';
import { ZAP_RECEIPT_KIND } from '@/lib/zap';
import { buildStatsFilters } from '@/lib/noteStats';

export interface NoteStats {
  replies: NostrEvent[];
  reposts: NostrEvent[];
  reactions: NostrEvent[];
  zaps: NostrEvent[];
}

const EMPTY: NoteStats = { replies: [], reposts: [], reactions: [], zaps: [] };

type Relay = ReturnType<typeof useNostr>['nostr'];

const loaders = new WeakMap<object, BatchLoader<string, NoteStats>>();

/**
 * Only replies that point at this event as their direct parent (NIP-10).
 *
 * A note in a deep thread tags the root as well as its parent, so without this
 * the root's reply count would be the size of the entire conversation.
 */
function isDirectReply(event: NostrEvent, parentId: string): boolean {
  return getThreadPosition(event).parentId === parentId;
}

function getLoader(nostr: Relay): BatchLoader<string, NoteStats> {
  const existing = loaders.get(nostr as object);
  if (existing) return existing;

  const loader = createBatchLoader<string, NoteStats>({
    windowMs: 80,
    maxBatchSize: 60,
    emptyValue: () => EMPTY,
    async fetch(keys) {
      // Still one request; the filters are separate so the budgets are
      const events = await nostr.query(buildStatsFilters(keys), {
        signal: AbortSignal.timeout(8000),
      });

      const results = new Map<string, NoteStats>();
      for (const key of keys) {
        results.set(key, { replies: [], reposts: [], reactions: [], zaps: [] });
      }

      for (const event of events) {
        for (const [name, value] of event.tags) {
          if (name !== 'e' && name !== 'a') continue;

          const bucket = results.get(value);
          if (!bucket) continue;

          if (event.kind === 1) {
            if (isDirectReply(event, value)) bucket.replies.push(event);
          } else if (event.kind === 6 || event.kind === 16) {
            bucket.reposts.push(event);
          } else if (event.kind === 7) {
            bucket.reactions.push(event);
          } else if (event.kind === ZAP_RECEIPT_KIND) {
            bucket.zaps.push(event);
          }
        }
      }

      return results;
    },
  });

  loaders.set(nostr as object, loader);
  return loader;
}

/**
 * Engagement counts for a note. Requests from every visible post collapse into
 * a single relay query, instead of the three-per-post the separate reaction,
 * repost and reply hooks used to issue.
 */
export function useNoteStats(eventId: string | undefined) {
  const { nostr } = useNostr();
  const loader = useMemo(() => getLoader(nostr), [nostr]);

  const query = useQuery<NoteStats>({
    queryKey: ['note-stats', eventId ?? ''],
    queryFn: async () => {
      if (!eventId) return EMPTY;
      return loader.load(eventId);
    },
    enabled: !!eventId,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2000),
  });

  return {
    ...(query.data ?? EMPTY),
    isLoading: query.isLoading,
  };
}
