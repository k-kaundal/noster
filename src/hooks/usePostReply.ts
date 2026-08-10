import { useMutation, useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { buildReplyTags } from '@/lib/thread';
import {
  buildQuoteTags,
  extractMentionPubkeys,
  extractQuotedEvents,
} from '@/lib/mention';

interface PostReplyVariables {
  /** The note being answered. */
  parent: NostrEvent;
  content: string;
  /** Media or other tags to carry alongside the threading tags. */
  extraTags?: string[][];
}

/**
 * Publishes a reply, tagged so the thread holds together.
 *
 * Every reply composer in the app goes through here rather than assembling `e`
 * tags itself. Threading breaks in ways that are invisible to the author —
 * their reply posts fine and simply never shows up under the conversation —
 * so the tags are worth building in exactly one place.
 */
export function usePostReply() {
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ parent, content, extraTags = [] }: PostReplyVariables) => {
      const threading = buildReplyTags(parent);

      /**
       * NIP-27 references in the reply body.
       *
       * Mentioning someone in a reply did nothing at all: the `nostr:` link
       * rendered, and the person named was never tagged, so they were never
       * told. Anyone already tagged by the threading — the parent's author,
       * the thread's participants — is skipped, since a second `p` tag for
       * one person is a second notification for one reply.
       */
      const alreadyTagged = new Set(
        threading.filter(([name]) => name === 'p').map(([, value]) => value)
      );

      const mentions = extractMentionPubkeys(content, nip19.decode)
        .filter((pubkey) => !alreadyTagged.has(pubkey))
        .map((pubkey) => ['p', pubkey]);

      const quotes = buildQuoteTags(extractQuotedEvents(content, nip19.decode));

      return createEvent({
        kind: 1,
        content,
        tags: [...threading, ...mentions, ...quotes, ...extraTags],
      });
    },
    onSuccess: (_event, { parent }) => {
      // The reply belongs to a thread, not just to its parent, so the whole
      // conversation is refetched rather than one note's counts
      queryClient.invalidateQueries({ queryKey: ['thread'] });
      queryClient.invalidateQueries({ queryKey: ['note-stats', parent.id] });
      queryClient.invalidateQueries({ queryKey: ['replies', parent.id] });
    },
  });
}
