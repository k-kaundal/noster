import { useMutation } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { REPORT_KIND, buildReportTags, type ReportType } from '@/lib/reactions';

/**
 * Publishes a NIP-56 report.
 *
 * Reports are public events, not a private channel to a moderator — there is
 * no central authority on Nostr to receive them. They are a signal relays and
 * other clients can choose to act on, so the UI says so rather than implying
 * someone is guaranteed to review it.
 */
export function useReport() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (input: {
      pubkey: string;
      eventId?: string;
      kind?: number;
      type: ReportType;
      reason?: string;
    }) => {
      if (!user) throw new Error('You must be logged in to report');
      if (input.pubkey === user.pubkey) {
        throw new Error('You cannot report yourself');
      }

      await createEvent({
        kind: REPORT_KIND,
        content: input.reason?.trim() ?? '',
        tags: buildReportTags(input),
      });
    },
    onSuccess: () => {
      toast({
        title: 'Report published',
        description:
          'Relays and clients can act on it. Mute the account if you also want it out of your feed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not report',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    report: mutation.mutateAsync,
    isReporting: mutation.isPending,
  };
}
