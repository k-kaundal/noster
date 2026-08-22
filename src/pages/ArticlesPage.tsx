import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, PenSquare, X } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { RelaySelector } from '@/components/RelaySelector';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArticleCard,
  ArticleCardSkeleton,
} from '@/components/articles/ArticleCard';
import { useArticles } from '@/hooks/useArticles';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useSeo } from '@/hooks/useSeo';
import { cn } from '@/lib/utils';

/** How many topics are worth offering before the row becomes a wall. */
const MAX_TOPICS = 12;

/**
 * Everything long-form, and nothing else.
 *
 * Articles were reachable two ways before this: from somebody's profile, if
 * you already knew they wrote, or as a card in a timeline, where a piece
 * somebody spent an afternoon on scrolls past between two one-line notes.
 * Neither is a way to find something to read.
 *
 * So this page carries only kind 30023 and is laid out for deciding what to
 * read rather than for keeping up — a cover, a title, an extract and a
 * reading time, in a grid that can be scanned rather than a column that has
 * to be scrolled through in order.
 */
export function ArticlesPage() {
  const { user } = useCurrentUser();
  const { followingList } = useFollows(user?.pubkey || '');

  const [scope, setScope] = useState<'latest' | 'following'>('latest');
  const [topic, setTopic] = useState<string | null>(null);

  useSeo({
    title: 'Articles',
    description:
      'Long-form writing on Nostr — essays, guides and posts worth sitting down with.',
    path: '/articles',
  });

  const authors = useMemo(
    () => followingList.map((follow) => follow.pubkey),
    [followingList]
  );

  /*
   * A reader with no follows has no Following tab worth showing, so the
   * control is hidden rather than offered and then found empty.
   */
  const canFollow = !!user && authors.length > 0;
  const following = scope === 'following' && canFollow;

  const { articles, isLoading } = useArticles({
    authors: following ? authors : undefined,
    hashtag: topic ?? undefined,
    limit: 60,
  });

  /**
   * Topics taken from the articles in hand rather than from a fixed list.
   *
   * A curated set of subjects would be this app's opinion about what Nostr
   * writes about; this is what it actually wrote about, and it empties itself
   * honestly when a relay has nothing.
   *
   * Left alone while a topic is selected, so choosing one does not rebuild the
   * row it was chosen from and move every other button out from under the
   * cursor.
   */
  const topics = useMemo(() => {
    if (topic) return null;

    const counts = new Map<string, number>();
    for (const article of articles) {
      for (const tag of article.hashtags) {
        const clean = tag.trim().toLowerCase();
        if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TOPICS)
      .map(([name]) => name);
  }, [articles, topic]);

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={BookOpen}
          title="Articles"
          description="Long-form writing, laid out for reading rather than scrolling."
          action={
            user ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/write">
                  <PenSquare className="mr-2 h-4 w-4" />
                  Write
                </Link>
              </Button>
            ) : undefined
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          {canFollow && (
            <Tabs
              value={scope}
              onValueChange={(value) =>
                setScope(value as 'latest' | 'following')
              }
            >
              <TabsList>
                <TabsTrigger value="latest">Latest</TabsTrigger>
                <TabsTrigger value="following">Following</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {topic && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTopic(null)}
              className="gap-1.5"
            >
              #{topic}
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Only when there is something to choose between */}
        {!!topics?.length && (
          <div className="flex flex-wrap gap-1.5">
            {topics.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setTopic(name)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors',
                  'hover:border-primary/40 hover:bg-muted/50 hover:text-foreground'
                )}
              >
                #{name}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <ArticleCardSkeleton key={index} />
            ))}
          </div>
        ) : !articles.length ? (
          <EmptyState
            icon={BookOpen}
            title={
              topic
                ? `Nothing tagged #${topic}`
                : following
                  ? 'Nobody you follow has published an article'
                  : 'No articles on this relay'
            }
            description={
              topic
                ? 'Try another topic, or clear the filter.'
                : following
                  ? 'Switch to Latest to read what everybody else is writing.'
                  : 'Long-form posts are stored like any other event, so a relay that carries none has none to show.'
            }
            showRelaySelector={!topic && !following}
            action={
              topic ? (
                <Button variant="outline" onClick={() => setTopic(null)}>
                  Clear topic
                </Button>
              ) : following ? (
                <Button variant="outline" onClick={() => setScope('latest')}>
                  Show latest
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/*
              Two columns, not one. A list of articles is browsed rather than
              read in order, and a single column of cover images makes six
              articles a page and a half of scrolling.
            */}
            <div className="grid gap-4 sm:grid-cols-2">
              {articles.map((article) => (
                <ArticleCard
                  key={`${article.event.pubkey}:${article.slug}`}
                  article={article}
                />
              ))}
            </div>

            <div className="space-y-3 pt-2 text-center">
              <p className="text-sm text-muted-foreground">
                {articles.length === 1
                  ? '1 article from this relay'
                  : `${articles.length} articles from this relay`}
              </p>
              {/* The honest next step when a list looks short: articles live
                  on whichever relays their authors chose, not on ours */}
              <RelaySelector className="mx-auto max-w-xs" />
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

export default ArticlesPage;
