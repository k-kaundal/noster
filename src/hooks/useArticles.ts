import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMuteList } from '@/hooks/useMuteList';
import { filterMuted } from '@/lib/mute';
import type { Nip44Signer } from '@/lib/nip60';
import {
  DRAFT_WRAP_KIND,
  draftIdentifierOf,
  isDeletedDraft,
  parseDraft,
} from '@/lib/nip37';
import {
  ARTICLE_DRAFT_KIND,
  ARTICLE_KIND,
  parseArticle,
  type Article,
} from '@/lib/article';

interface ArticleQuery {
  /** Only this author's articles. */
  author?: string;
  /** Only articles carrying this `t` tag. */
  hashtag?: string;
  limit?: number;
}

/**
 * Keeps one revision per article.
 *
 * An addressable event is replaced rather than superseded, but relays can
 * still hold older revisions and hand back several. The newest wins, which is
 * what the address is supposed to resolve to.
 */
function latestPerAddress(events: NostrEvent[]): Article[] {
  const byAddress = new Map<string, Article>();

  for (const event of events) {
    const article = parseArticle(event);
    if (!article || !article.content.trim()) continue;

    const address = `${event.kind}:${event.pubkey}:${article.slug}`;
    const existing = byAddress.get(address);

    if (!existing || existing.updatedAt < article.updatedAt) {
      byAddress.set(address, article);
    }
  }

  return [...byAddress.values()].sort(
    (a, b) => b.publishedAt - a.publishedAt
  );
}

/** Published long-form articles. */
export function useArticles({ author, hashtag, limit = 30 }: ArticleQuery = {}) {
  const { nostr } = useNostr();
  const { list: muteList } = useMuteList();

  const query = useQuery({
    queryKey: ['articles', author ?? '', hashtag ?? '', limit],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      const events = await nostr.query(
        [
          {
            kinds: [ARTICLE_KIND],
            ...(author ? { authors: [author] } : {}),
            ...(hashtag ? { '#t': [hashtag.toLowerCase()] } : {}),
            limit,
          },
        ],
        { signal }
      );

      return events;
    },
    staleTime: 60 * 1000,
  });

  const articles = useMemo(
    () => latestPerAddress(filterMuted(query.data ?? [], muteList)),
    [query.data, muteList]
  );

  return { articles, isLoading: query.isLoading, error: query.error as Error | null };
}

/**
 * The signed-in author's own drafts.
 *
 * Two sources, because drafts changed shape. New ones are NIP-37 wraps
 * (`kind:31234`) whose whole content is encrypted to the author's own key.
 * Old ones are `kind:30024` — plaintext, which NIP-23 now calls deprecated
 * for exactly the reason it should be: a relay served them to anyone who
 * asked, so nothing about them was ever private.
 *
 * The old kind is still read, because someone's unfinished writing should not
 * vanish from their drafts list the day the storage improved. It is no longer
 * written to; saving an old draft again stores it encrypted.
 */
export function useMyDrafts() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const query = useQuery({
    queryKey: ['article-drafts', user?.pubkey ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);
      const pubkey = user!.pubkey;

      const events = await nostr.query(
        [
          { kinds: [DRAFT_WRAP_KIND], authors: [pubkey], '#k': [String(ARTICLE_KIND)], limit: 50 },
          { kinds: [ARTICLE_DRAFT_KIND], authors: [pubkey], limit: 50 },
        ],
        { signal }
      );

      const legacy = events.filter((event) => event.kind === ARTICLE_DRAFT_KIND);
      const wraps = events.filter((event) => event.kind === DRAFT_WRAP_KIND);

      const signer = user!.signer as Nip44Signer;

      /**
       * Each wrap costs a round trip to the signer, which for a bunker means
       * a relay round trip each. Done in parallel, and a failure on one is
       * skipped rather than losing the whole list — a draft written under a
       * key you no longer hold should not hide the rest.
       */
      const decrypted = await Promise.all(
        wraps.map(async (event): Promise<NostrEvent | null> => {
          // A blanked wrap is NIP-37's way of saying the draft is deleted
          if (isDeletedDraft(event) || !signer.nip44) return null;

          try {
            const draft = parseDraft(
              await signer.nip44.decrypt(pubkey, event.content)
            );
            if (!draft) return null;

            const slug = draftIdentifierOf(event);

            /**
             * Presented under the draft kind, not the wrapped one.
             *
             * Everything downstream — the list, the editor, `parseArticle`'s
             * `isDraft` — already understands "an article event that is a
             * draft", and nothing else needs to learn what a wrap is. It also
             * gives a wrap and a legacy `kind:30024` draft of the same slug
             * one address, so re-saving an old draft replaces the row instead
             * of adding a second one beside it.
             */
            return {
              ...event,
              kind: ARTICLE_DRAFT_KIND,
              content: draft.content,
              tags: slug
                ? [['d', slug], ...draft.tags.filter(([name]) => name !== 'd')]
                : draft.tags,
            };
          } catch {
            // A signer that declined, or a wrap this key cannot open
            return null;
          }
        })
      );

      return [
        ...decrypted.filter((event): event is NostrEvent => !!event),
        ...legacy,
      ];
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  const drafts = useMemo(() => latestPerAddress(query.data ?? []), [query.data]);

  return { drafts, isLoading: query.isLoading };
}

/** One article, addressed by author and slug. */
export function useArticle(
  pubkey: string | undefined,
  slug: string | undefined,
  kind: number = ARTICLE_KIND
) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['article', kind, pubkey ?? '', slug ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      const events = await nostr.query(
        [{ kinds: [kind], authors: [pubkey!], '#d': [slug!], limit: 5 }],
        { signal }
      );

      // Several relays, possibly several revisions — the newest is the article
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
      return newest ? parseArticle(newest) : null;
    },
    enabled: !!pubkey && !!slug,
    staleTime: 60 * 1000,
  });

  return {
    article: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
