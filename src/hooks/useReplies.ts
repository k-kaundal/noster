import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

export function useReplies(eventId: string) {
  const { nostr } = useNostr();

  // Query replies for this event
  const repliesQuery = useQuery({
    queryKey: ['replies', eventId],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(1500)]);
      const events = await nostr.query([{
        kinds: [1], // Text note replies
        '#e': [eventId],
        limit: 500,
      }], { signal });

      // Filter out the original event and only return actual replies
      const replies = events.filter(event => event.id !== eventId);

      // For top-level replies, only return replies that are directly replying to this event
      // (not replies to other replies)
      const directReplies = replies.filter(reply => {
        const eTags = reply.tags.filter(tag => tag[0] === 'e');
        // If there's only one e tag, or the last e tag points to our event, it's a direct reply
        if (eTags.length === 0) return false;
        if (eTags.length === 1) return eTags[0][1] === eventId;
        // For multiple e tags, the last one should be the direct reply target (NIP-10)
        const lastETag = eTags[eTags.length - 1];
        return lastETag[1] === eventId;
      });

      return directReplies;
    },
    enabled: !!eventId,
  });

  const replyCount = repliesQuery.data?.length || 0;

  return {
    replies: repliesQuery.data || [],
    replyCount,
    isLoading: repliesQuery.isLoading,
  };
}