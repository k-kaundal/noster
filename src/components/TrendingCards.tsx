import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { AtSign, Hash } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface TrendingHashtagsProps {
  hashtags: { tag: string; count: number }[];
  isLoading?: boolean;
  limit?: number;
  className?: string;
}

/** Ranked list of hashtags seen across recent notes. */
export function TrendingHashtags({
  hashtags,
  isLoading,
  limit = 5,
  className,
}: TrendingHashtagsProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Hash className="h-4 w-4 text-reply" />
          Trending hashtags
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {isLoading ? (
          <RankedSkeleton />
        ) : hashtags.length === 0 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">
            Nothing trending on this relay yet.
          </p>
        ) : (
          <ul>
            {hashtags.slice(0, limit).map(({ tag, count }, index) => (
              <li key={tag}>
                <Link
                  to={`/t/${encodeURIComponent(tag)}`}
                  className="flex items-center gap-3 px-6 py-2 transition-colors hover:bg-accent/60"
                >
                  <span className="w-4 text-sm font-semibold tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    #{tag}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface TrendingPeopleProps {
  mentions: { pubkey: string; count: number }[];
  isLoading?: boolean;
  limit?: number;
  className?: string;
}

/** Ranked list of the most-mentioned pubkeys. */
export function TrendingPeople({
  mentions,
  isLoading,
  limit = 5,
  className,
}: TrendingPeopleProps) {
  const validMentions = mentions.filter(
    (m) => m?.pubkey && typeof m.pubkey === 'string' && /^[0-9a-f]{64}$/.test(m.pubkey)
  );

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AtSign className="h-4 w-4 text-repost" />
          Most mentioned
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {isLoading ? (
          <RankedSkeleton withAvatar />
        ) : validMentions.length === 0 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">
            No mentions found on this relay.
          </p>
        ) : (
          <ul>
            {validMentions.slice(0, limit).map(({ pubkey, count }, index) => (
              <MentionedUser
                key={pubkey}
                pubkey={pubkey}
                count={count}
                rank={index + 1}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MentionedUser({
  pubkey,
  count,
  rank,
}: {
  pubkey: string;
  count: number;
  rank: number;
}) {
  // A malformed pubkey would make npubEncode throw, so it renders nothing —
  // but the check runs after the hook, since skipping it would change the
  // hook order between renders
  const isValidPubkey = !!pubkey && /^[0-9a-f]{64}$/.test(pubkey);

  const author = useAuthor(isValidPubkey ? pubkey : undefined);
  const metadata = author.data?.metadata;
  if (!isValidPubkey) return null;

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(pubkey);

  return (
    <li>
      <Link
        to={`/${nip19.npubEncode(pubkey)}`}
        className="flex items-center gap-3 px-6 py-2 transition-colors hover:bg-accent/60"
      >
        <span className="w-4 text-sm font-semibold tabular-nums text-muted-foreground">
          {rank}
        </span>
        <Avatar className="h-7 w-7">
          <AvatarImage src={metadata?.picture} alt="" />
          <AvatarFallback className="text-[10px]">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {displayName}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      </Link>
    </li>
  );
}

function RankedSkeleton({ withAvatar = false }: { withAvatar?: boolean }) {
  return (
    <div className="space-y-3 px-6 pb-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-4" />
          {withAvatar && <Skeleton className="h-7 w-7 rounded-full" />}
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-6" />
        </div>
      ))}
    </div>
  );
}
