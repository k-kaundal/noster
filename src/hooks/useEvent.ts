import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

export function useEvent(eventId: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['event', eventId],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(1500)]);
      const events = await nostr.query([{
        ids: [eventId],
        limit: 1,
      }], { signal });
      
      return events[0] as NostrEvent | undefined;
    },
    enabled: !!eventId,
  });
}