import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { DRAFT_WRAP_KIND } from '@/lib/nip37';
import { ARTICLE_KIND } from '@/lib/article';

/**
 * Deletes a NIP-37 draft.
 *
 * Deletion is an empty wrap at the same address, which is the only way to
 * make a relay stop holding it that does not depend on the relay honouring
 * a NIP-09 deletion request. The wrap is addressable, so publishing a blank
 * one replaces the draft in place.
 */
export function useDeleteDraft() {
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ identifier }: { identifier: string }) => {
      await publishEvent({
        kind: DRAFT_WRAP_KIND,
        content: '',
        tags: [
          ['d', identifier],
          ['k', String(ARTICLE_KIND)],
          [
            'expiration',
            String(Math.floor(Date.now() / 1000) + 90 * 86400),
          ],
        ],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['article-drafts'] });

      toast({
        title: 'Draft deleted',
        description: 'Relays that honour replacements will drop it.',
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
}
