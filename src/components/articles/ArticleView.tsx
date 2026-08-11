import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { BadgeCheck, Clock, Pencil } from 'lucide-react';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSeo } from '@/hooks/useSeo';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { UserHoverCard } from '@/components/UserHoverCard';
import { ZapButton } from '@/components/ZapButton';
import { CommentsSection } from '@/components/comments/CommentsSection';
import { Markdown } from '@/components/articles/Markdown';
import { MaybeWarned } from '@/components/ContentWarning';
import { readContentWarning } from '@/lib/contentWarning';
import { ArticleEditor } from '@/components/articles/ArticleEditor';
import { markdownToText } from '@/lib/markdown';
import { readingMinutes, type Article } from '@/lib/article';

/** A whole article, with its comments. */
export function ArticleView({ article }: { article: Article }) {
  const { user } = useCurrentUser();
  const author = useAuthor(article.event.pubkey);
  const metadata = author.data?.metadata;
  const [isEditing, setIsEditing] = useState(false);
  const queryClient = useQueryClient();

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(article.event.pubkey);
  const npub = nip19.npubEncode(article.event.pubkey);
  const isMine = user?.pubkey === article.event.pubkey;

  /**
   * Gated in two places rather than around the whole page: the title, author
   * and date are how a reader decides whether to open it, and covering those
   * leaves nothing to make the decision from. The cover image and the body are
   * the article itself.
   */
  const warning = readContentWarning(article.event);

  useSeo({
    title: article.title,
    description: article.summary || markdownToText(article.content).slice(0, 200),
    image: article.image,
    path: `/${nip19.naddrEncode({
      kind: article.event.kind,
      pubkey: article.event.pubkey,
      identifier: article.slug,
    })}`,
    type: 'article',
    publishedTime: new Date(article.publishedAt * 1000).toISOString(),
    author: displayName,
  });

  return (
    <div className="space-y-6">
      <article className="space-y-6">
        {article.image && (
          <MaybeWarned event={article.event} warning={warning} opaque>
            <img
              src={article.image}
              alt=""
              className="max-h-[420px] w-full rounded-2xl border object-cover"
            />
          </MaybeWarned>
        )}

        <header className="space-y-4">
          {article.isDraft && (
            <Badge variant="secondary">
              Draft — relays will serve this to anyone who asks
            </Badge>
          )}

          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {article.title}
          </h1>

          {article.summary && (
            <p className="text-lg text-muted-foreground">{article.summary}</p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-y py-3 text-sm">
            <UserHoverCard pubkey={article.event.pubkey}>
              <Link to={`/${npub}`} className="flex items-center gap-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={metadata?.picture} alt="" />
                  <AvatarFallback className="text-[10px]">
                    {displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium hover:underline">{displayName}</span>
              </Link>
            </UserHoverCard>

            {metadata?.nip05 && (
              <BadgeCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            )}

            <span className="text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <time
              className="text-muted-foreground"
              dateTime={new Date(article.publishedAt * 1000).toISOString()}
            >
              {new Date(article.publishedAt * 1000).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>

            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {readingMinutes(article.content)} min
            </span>

            <div className="ml-auto flex items-center gap-2">
              {isMine && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
              )}
              <ZapButton target={article.event} />
            </div>
          </div>
        </header>

        {/* Revised after first publication, which the byline date hides */}
        {article.updatedAt - article.publishedAt > 60 && (
          <p className="text-xs text-muted-foreground">
            Updated{' '}
            {new Date(article.updatedAt * 1000).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        )}

        <MaybeWarned event={article.event} warning={warning}>
          <Markdown source={article.content} />
        </MaybeWarned>

        {article.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t pt-5">
            {article.hashtags.map((tag) => (
              <Link key={tag} to={`/t/${tag}`}>
                <Badge variant="outline">#{tag}</Badge>
              </Link>
            ))}
          </div>
        )}
      </article>

      <Card className="p-4 sm:p-5">
        <CommentsSection
          root={article.event}
          title="Responses"
          emptyStateMessage="No responses yet"
          emptyStateSubtitle="Be the first to reply to this article."
        />
      </Card>

      {isEditing && (
        <ArticleEditor
          article={article}
          onClose={() => setIsEditing(false)}
          onSave={() => {
            setIsEditing(false);
            // The edit replaced the addressable event, so the cached copy is
            // now the old revision — without this the page keeps showing it
            queryClient.invalidateQueries({ queryKey: ['article'] });
            queryClient.invalidateQueries({ queryKey: ['articles'] });
          }}
        />
      )}
    </div>
  );
}
