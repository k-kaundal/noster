import { useMutation, useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  ARTICLE_DRAFT_KIND,
  ARTICLE_KIND,
  buildArticleTags,
  type ArticleDraft,
} from '@/lib/article';

interface PublishVariables {
  draft: ArticleDraft;
  /** A draft stays private-ish; publishing puts it under kind 30023. */
  asDraft: boolean;
}

/**
 * Publishing an article, or saving it as a draft.
 *
 * The slug is the address, so republishing under the same one replaces the
 * previous revision rather than adding a second copy. `published_at` is
 * carried through edits, which is what keeps a corrected article dated when it
 * was written rather than when it was last touched.
 */
export function usePublishArticle() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const publish = useMutation({
    mutationFn: async ({ draft, asDraft }: PublishVariables) => {
      if (!user) throw new Error('Log in to publish');
      if (!draft.title.trim()) throw new Error('Give it a title');
      if (!draft.content.trim()) throw new Error('Write something first');

      const event = await createEvent({
        kind: asDraft ? ARTICLE_DRAFT_KIND : ARTICLE_KIND,
        content: draft.content,
        tags: buildArticleTags(draft),
      });

      return {
        event,
        naddr: nip19.naddrEncode({
          kind: asDraft ? ARTICLE_DRAFT_KIND : ARTICLE_KIND,
          pubkey: user.pubkey,
          identifier: draft.slug,
        }),
        asDraft,
      };
    },
    onSuccess: ({ asDraft }) => {
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      queryClient.invalidateQueries({ queryKey: ['article'] });
      queryClient.invalidateQueries({ queryKey: ['article-drafts'] });

      toast({
        title: asDraft ? 'Draft saved' : 'Article published',
        description: asDraft
          ? 'Only you will see it in your drafts — but relays serve drafts to anyone who asks for them.'
          : 'It is on the relays you write to.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not publish',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    publish: publish.mutateAsync,
    isPublishing: publish.isPending,
  };
}
