import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { DELETION_KIND, buildDeletionTags } from '@/lib/reactions';

/**
 * Requests deletion of your own events (NIP-09).
 *
 * A deletion request is exactly that — a request. Relays are free to ignore
 * it, and any relay that never received it keeps serving the note, so the UI
 * must not promise the note is gone everywhere.
 */
export function useDeleteEvent() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      events,
      reason = '',
    }: {
      events: NostrEvent[];
      reason?: string;
    }) => {
      if (!user) throw new Error('You must be logged in to delete');

      // Signing someone else's id would produce a request every relay ignores
      const foreign = events.find((event) => event.pubkey !== user.pubkey);
      if (foreign) throw new Error('You can only delete your own posts');

      await createEvent({
        kind: DELETION_KIND,
        content: reason,
        tags: buildDeletionTags(events),
      });

      return events.map((event) => event.id);
    },
    onSuccess: (ids) => {
      // Drop the note from every cached feed rather than waiting for a refetch
      queryClient.setQueriesData<unknown>(
        { queryKey: ['feed'] },
        (data: unknown) => removeEvents(data, ids)
      );
      queryClient.invalidateQueries({ queryKey: ['note-stats'] });

      toast({
        title: 'Deletion requested',
        description:
          'Relays that honour deletions will drop it. Copies elsewhere may remain.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not delete',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    deleteEvents: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
}

/** Strips deleted ids out of a cached feed, paged or flat. */
function removeEvents(data: unknown, ids: string[]): unknown {
  if (!data) return data;

  const keep = (event: NostrEvent) => !ids.includes(event.id);

  if (Array.isArray(data)) {
    return (data as NostrEvent[]).filter(keep);
  }

  const paged = data as { pages?: NostrEvent[][] };
  if (Array.isArray(paged.pages)) {
    return {
      ...paged,
      pages: paged.pages.map((page) => page.filter(keep)),
    };
  }

  return data;
}
