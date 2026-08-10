import { useMutation, useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import type { Nip44Signer } from '@/lib/nip60';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  ARTICLE_KIND,
  buildArticleTags,
  type ArticleDraft,
} from '@/lib/article';
import { extractMentionPubkeys, extractQuotedEvents } from '@/lib/mention';
import {
  DRAFT_WRAP_KIND,
  buildDraftWrapTags,
  serializeDraft,
} from '@/lib/nip37';

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

  /**
   * Saving a draft as a NIP-37 wrap.
   *
   * The whole unsigned article goes inside `.content`, encrypted to the
   * author's own key, so what the relay stores is a blob it cannot read. The
   * old `kind:30024` drafts were plaintext — a relay served them to anyone
   * who asked, and "unpublished" meant only that this app declined to list
   * them.
   */
  const saveDraft = async (draft: ArticleDraft, tags: string[][]) => {
    if (!user) throw new Error('Log in to publish');

    const signer = user.signer as Nip44Signer;
    if (!signer.nip44) {
      throw new Error(
        'Your signer cannot encrypt, so a private draft cannot be saved. Publish it, or upgrade your signer.'
      );
    }

    const wrapped = serializeDraft({
      kind: ARTICLE_KIND,
      content: draft.content,
      tags,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: user.pubkey,
    });

    return await createEvent({
      kind: DRAFT_WRAP_KIND,
      content: await signer.nip44.encrypt(user.pubkey, wrapped),
      tags: buildDraftWrapTags({ identifier: draft.slug, kind: ARTICLE_KIND }),
    });
  };

  const publish = useMutation({
    mutationFn: async ({ draft, asDraft }: PublishVariables) => {
      if (!user) throw new Error('Log in to publish');
      if (!draft.title.trim()) throw new Error('Give it a title');
      if (!draft.content.trim()) throw new Error('Write something first');

      // NIP-23 routes references through NIP-27: written as `nostr:` links in
      // the body, and tagged so they exist to anything but a reader of that
      // paragraph
      const tags = buildArticleTags(draft, {
        mentions: extractMentionPubkeys(draft.content, nip19.decode),
        quotes: extractQuotedEvents(draft.content, nip19.decode),
      });

      const event = asDraft
        ? await saveDraft(draft, tags)
        : await createEvent({
            kind: ARTICLE_KIND,
            content: draft.content,
            tags,
          });

      return {
        event,
        naddr: nip19.naddrEncode({
          kind: asDraft ? DRAFT_WRAP_KIND : ARTICLE_KIND,
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
          ? 'Encrypted to your key, so the relay holds it without being able to read it.'
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
