import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { calculateQualityScore, type QualityScore } from '@/lib/quality';
import { useAuthor } from './useAuthor';

/**
 * Calculate quality score for a post, fetching author metadata as needed
 */
export function useQualityScore(event: NostrEvent): QualityScore | undefined {
  const author = useAuthor(event.pubkey);

  const score = useMemo(() => {
    if (!author.data) return undefined;

    const authorMetadata = author.data.metadata;
    const authorEvent = author.data.event;

    return calculateQualityScore(event, {
      nip05: authorMetadata?.nip05,
      followers: undefined, // Not available from metadata
      created_at: authorEvent?.created_at,
    });
  }, [event, author.data]);

  return score;
}
