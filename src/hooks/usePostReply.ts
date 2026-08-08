import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { buildReplyTags } from '@/lib/thread';

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
      return createEvent({
        kind: 1,
        content,
        tags: [...buildReplyTags(parent), ...extraTags],
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
