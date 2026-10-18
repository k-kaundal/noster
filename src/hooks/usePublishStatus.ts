import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useNostrPublish } from '@/hooks/useNostrPublish';
import {
  USER_STATUS_KIND,
  buildStatusTags,
  clearStatusTags,
  type StatusType,
} from '@/lib/nip38';

/**
 * Publishes a NIP-38 user status.
 *
 * A status is addressable, so publishing another at the same `d` tag replaces
 * the previous one — there is no "list of statuses" to manage, only the
 * current one per type. Clearing is the same event with empty content, which
 * is how the spec says "nothing to show" without depending on a relay
 * honouring a deletion request.
 */
export function usePublishStatus() {
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      type: StatusType;
      content: string;
      reference?: string;
      /** Seconds from now. Omit for the default session-length status. */
      expiresInSeconds?: number;
    }) => {
      const expiresAt = input.expiresInSeconds
        ? Math.floor(Date.now() / 1000) + input.expiresInSeconds
        : undefined;

      return createEvent({
        kind: USER_STATUS_KIND,
        content: input.content,
        tags: buildStatusTags({
          type: input.type,
          reference: input.reference,
          expiresAt,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['user-statuses-for'] });
    },
  });
}

/** Clears a status by publishing an empty one at the same address. */
export function useClearStatus() {
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (type: StatusType) => {
      return createEvent({
        kind: USER_STATUS_KIND,
        content: '',
        tags: clearStatusTags(type),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['user-statuses-for'] });
    },
  });
}
