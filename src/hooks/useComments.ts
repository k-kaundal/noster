import { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import {
  isTopLevel,
  isValidComment,
  parentOf,
  targetFromEvent,
  targetFromUrl,
  type CommentTarget,
} from '@/lib/nip22';

/**
 * Every comment under a root, arranged into a thread.
 *
 * One query, filtered on the uppercase root-scope tag, which is exactly what
 * that tag is for: it returns the whole discussion at any depth in a single
 * round trip, and the shape is then worked out locally from the lowercase
 * parent tags.
 */
export function useComments(root: NostrEvent | URL, limit?: number) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['comments', root instanceof URL ? root.toString() : root.id, limit],
    queryFn: async (c) => {
      const target: CommentTarget =
        root instanceof URL ? targetFromUrl(root) : targetFromEvent(root);

      const filter: NostrFilter = { kinds: [1111] };

      if (target.type === 'external') {
        filter['#I'] = [target.value];
      } else if (target.address) {
        filter['#A'] = [target.address];
      } else {
        filter['#E'] = [target.id];
      }

      if (typeof limit === 'number') {
        filter.limit = limit;
      }

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const returned = await nostr.query([filter], { signal });

      /**
       * A comment missing its required `K`/`k` tags cannot be placed: there is
       * no way to know what it is answering or what that thing was. Rendering
       * it anyway would mean guessing, and a wrong guess puts someone's reply
       * under a stranger's comment.
       */
      const events = returned.filter(isValidComment);

      /**
       * Children indexed once, rather than re-scanned per comment.
       *
       * The previous version walked the whole list recursively for every
       * comment it had, then did it again for each descendant — quadratic at
       * best, and it recursed once per level of nesting on a list a relay
       * chose the size of.
       */
      const children = new Map<string, NostrEvent[]>();
      for (const comment of events) {
        const parent = parentOf(comment);
        if (!parent) continue;

        const siblings = children.get(parent);
        if (siblings) {
          siblings.push(comment);
        } else {
          children.set(parent, [comment]);
        }
      }

      // Oldest first within a thread: a reply reads as an answer to what is
      // above it, which is only true in the order they were written
      for (const siblings of children.values()) {
        siblings.sort((a, b) => a.created_at - b.created_at);
      }

      const topLevelComments = events
        .filter((comment) => isTopLevel(comment, target))
        .sort((a, b) => b.created_at - a.created_at);

      const getDirectReplies = (commentId: string) =>
        children.get(commentId) ?? [];

      /**
       * Iterative rather than recursive: a relay can return any list it likes,
       * and a deep enough chain would otherwise overflow the stack while
       * someone was reading a comment section.
       */
      const getDescendants = (commentId: string): NostrEvent[] => {
        const found: NostrEvent[] = [];
        const queue = [...getDirectReplies(commentId)];
        const seen = new Set<string>();

        while (queue.length) {
          const next = queue.shift()!;
          if (seen.has(next.id)) continue;

          seen.add(next.id);
          found.push(next);
          queue.push(...getDirectReplies(next.id));
        }

        return found;
      };

      return {
        allComments: events,
        topLevelComments,
        getDescendants,
        getDirectReplies,
      };
    },
    enabled: !!root,
  });
}
