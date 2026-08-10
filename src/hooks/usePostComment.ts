import { useMutation, useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import type { NostrEvent } from '@nostrify/nostrify';
import { buildCommentTags, targetFromEvent, targetFromUrl } from '@/lib/nip22';
import { extractMentionPubkeys, extractQuotedEvents } from '@/lib/mention';

interface PostCommentParams {
  root: NostrEvent | URL; // The root event to comment on
  reply?: NostrEvent | URL; // Optional reply to another comment
  content: string;
}

function targetOf(item: NostrEvent | URL) {
  return item instanceof URL ? targetFromUrl(item) : targetFromEvent(item);
}

/** Post a NIP-22 (kind 1111) comment on an event. */
export function usePostComment() {
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ root, reply, content }: PostCommentParams) => {
      /**
       * NIP-22 says in as many words that comments MUST NOT be used to reply
       * to kind 1 notes — those are NIP-10 threads, and a kind 1111 hung off
       * one is invisible to every client that reads replies the documented
       * way. Refused here rather than at review time, because the two systems
       * look interchangeable right up until nobody sees the reply.
       */
      if (!(root instanceof URL) && root.kind === 1) {
        throw new Error(
          'Kind 1 notes are threaded with NIP-10 replies, not comments.'
        );
      }

      const tags = buildCommentTags({
        root: targetOf(root),
        parent: reply ? targetOf(reply) : undefined,
        // A mention or quote written only as a `nostr:` URI in the text
        // notifies nobody and is indexed by no relay
        mentions: extractMentionPubkeys(content, nip19.decode),
        quotes: extractQuotedEvents(content, nip19.decode),
      });

      return await publishEvent({ kind: 1111, content, tags });
    },
    onSuccess: (_, { root }) => {
      // Invalidate and refetch comments
      queryClient.invalidateQueries({
        queryKey: ['comments', root instanceof URL ? root.toString() : root.id]
      });
    },
  });
}
