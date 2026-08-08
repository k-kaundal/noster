import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useMuteList } from '@/hooks/useMuteList';
import { filterMuted } from '@/lib/mute';
import { getAltText } from '@/lib/eventKinds';
import { buildReplyTree, descendantsOf } from '@/lib/thread';

/**
 * True when a reply has a body worth a row in the thread.
 *
 * Deliberately stricter than the feed's renderable check, which counts an `e`
 * tag as content — every reply has one of those, so it would pass everything.
 * What matters here is whether there is anything to read.
 */
function hasBody(event: NostrEvent): boolean {
  if (event.content.trim()) return true;
  if (getAltText(event)) return true;

  return event.tags.some(([name]) => name === 'imeta' || name === 'url');
}

/**
 * Every reply in a conversation, as a tree.
 *
 * Fetched by the thread's root rather than one level at a time: a reply at any
 * depth tags the root, so a single query returns the whole conversation and
 * the shape is rebuilt locally. Walking down level by level would cost one
 * round trip per level and make a deep thread unfold in visible steps.
 */
export function useThread(rootId: string | undefined, focusedId: string) {
  const { nostr } = useNostr();
  const { list: muteList } = useMuteList();

  const query = useQuery({
    queryKey: ['thread', rootId, focusedId],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      const filters = [
        { kinds: [1, 1111], '#e': [rootId as string], limit: 300 },
      ];

      // Some clients tag only the parent, so a deep reply written by one of
      // them never appears in a query by root. Asking for the focused note's
      // own replies too costs nothing extra and keeps them visible.
      if (focusedId !== rootId) {
        filters.push({ kinds: [1, 1111], '#e': [focusedId], limit: 100 });
      }

      const events = await nostr.query(filters, { signal });

      // Relays fan out, so the same reply can arrive several times
      const byId = new Map<string, NostrEvent>();
      for (const event of events) {
        if (hasBody(event)) byId.set(event.id, event);
      }

      return [...byId.values()];
    },
    enabled: !!rootId,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const replies = useMemo(
    () => filterMuted(query.data ?? [], muteList),
    [query.data, muteList]
  );

  const tree = useMemo(
    () => buildReplyTree(replies, rootId ?? focusedId),
    [replies, rootId, focusedId]
  );

  const visible = useMemo(
    () => descendantsOf(tree, focusedId),
    [tree, focusedId]
  );

  return {
    /** Replies below the focused note, deepest structure intact. */
    tree: visible,
    /** Every reply in the conversation, at any depth. */
    total: replies.length,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
