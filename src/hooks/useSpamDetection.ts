import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { detectSpam, type SpamDetectionResult } from '@/lib/spam';
import { useAuthor } from './useAuthor';

/**
 * Detect spam in a post using multiple signals
 * Fetches author metadata for context
 */
export function useSpamDetection(
  event: NostrEvent,
  allEvents: NostrEvent[]
): SpamDetectionResult {
  const author = useAuthor(event.pubkey);

  const result = useMemo(() => {
    const authorMetadata = author.data?.metadata;
    return detectSpam(event, allEvents, {
      name: authorMetadata?.name,
      about: authorMetadata?.about,
      bot: authorMetadata?.bot,
    });
  }, [event, allEvents, author.data]);

  return result;
}
