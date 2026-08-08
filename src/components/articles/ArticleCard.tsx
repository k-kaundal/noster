import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { formatDistanceToNowStrict } from 'date-fns';
import { BadgeCheck, Clock, FileText } from 'lucide-react';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { markdownToText } from '@/lib/markdown';
import { readingMinutes, type Article } from '@/lib/article';
import { cn } from '@/lib/utils';

/** One article in a list: cover, title, and enough to decide whether to read it. */
export function ArticleCard({
  article,
  className,
}: {
  article: Article;
  className?: string;
}) {
  const author = useAuthor(article.event.pubkey);
  const metadata = author.data?.metadata;

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(article.event.pubkey);

  const naddr = nip19.naddrEncode({
    kind: article.event.kind,
    pubkey: article.event.pubkey,
    identifier: article.slug,
  });

  // A summary is optional, so fall back to the opening of the article itself
  const preview =
    article.summary || markdownToText(article.content).slice(0, 180);

  return (
    <Card className={cn('content-auto overflow-hidden hover-lift', className)}>
      <Link to={`/${naddr}`} className="block">
        {article.image && (
          <img
            src={article.image}
            alt=""
            loading="lazy"
            className="h-40 w-full object-cover sm:h-48"
          />
        )}

        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Avatar className="h-5 w-5">
              <AvatarImage src={metadata?.picture} alt="" />
              <AvatarFallback className="text-[9px]">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate font-medium text-foreground">
              {displayName}
            </span>
            {metadata?.nip05 && (
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
            )}
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              {formatDistanceToNowStrict(new Date(article.publishedAt * 1000))} ago
            </span>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-lg font-semibold leading-snug tracking-tight">
              {article.title}
            </h3>
            {preview && (
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {preview}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {readingMinutes(article.content)} min read
            </span>

            {article.isDraft && (
              <Badge variant="secondary" className="text-[10px]">
                Draft
              </Badge>
            )}

            {article.hashtags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                #{tag}
              </Badge>
            ))}
          </div>
        </div>
      </Link>
    </Card>
  );
}

export function ArticleCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="h-40 w-full sm:h-48" />
      <div className="space-y-3 p-5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </Card>
  );
}

/** Shown where a list of articles would be, when there are none. */
export function NoArticles({ message }: { message: string }) {
  return (
    <Card className="border-dashed">
      <div className="flex flex-col items-center gap-3 px-8 py-12 text-center">
        <FileText className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </Card>
  );
}
