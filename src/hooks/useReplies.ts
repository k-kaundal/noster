import { useNoteStats } from './useNoteStats';

/**
 * Direct replies to an event. Backed by the batched stats query, so a whole
 * screen of notes costs one request rather than one per note.
 */
export function useReplies(eventId: string) {
  const { replies, isLoading } = useNoteStats(eventId);

  return {
    replies,
    replyCount: replies.length,
    isLoading,
  };
}
