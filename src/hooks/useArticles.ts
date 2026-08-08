import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMuteList } from '@/hooks/useMuteList';
import { filterMuted } from '@/lib/mute';
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
 * Kept separate from published articles because a draft is a different kind,
 * and because nobody else should ever see them in a list — relays will serve
 * kind 30024 to anyone who asks, so this is privacy by nobody looking rather
 * than by enforcement. Worth saying out loud before writing anything into one.
 */
export function useMyDrafts() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const query = useQuery({
    queryKey: ['article-drafts', user?.pubkey ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      return nostr.query(
        [{ kinds: [ARTICLE_DRAFT_KIND], authors: [user!.pubkey], limit: 50 }],
        { signal }
      );
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
