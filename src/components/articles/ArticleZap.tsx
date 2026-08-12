import { Zap } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ZapDialog } from '@/components/ZapDialog';
import { LoginArea } from '@/components/auth/LoginArea';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useZaps } from '@/hooks/useZaps';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

/**
 * Paying the author, at the end of the article.
 *
 * There is already a zap control in the header, next to the byline, and for a
 * note that is the right and only place. An article is different: the moment
 * somebody wants to thank the writer arrives after five minutes of reading,
 * by which time the header is a long way up the page.
 *
 * It also says something when it cannot help. The header button renders
 * nothing at all when the reader is logged out, when the author has no
 * lightning address, or when it is your own piece — three silences that look
 * identical to a feature that is broken.
 */
export function ArticleZap({
  article,
  className,
}: {
  article: NostrEvent;
  className?: string;
}) {
  const { user } = useCurrentUser();
  const author = useAuthor(article.pubkey);
  const metadata = author.data?.metadata;

  const { totalSats, zapCount, isLoading } = useZaps(article);

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(article.pubkey);

  const payable = !!(metadata?.lud16 || metadata?.lud06);
  const isMine = user?.pubkey === article.pubkey;

  /**
   * The running total is worth showing even when this reader cannot add to
   * it — it is a fact about the article, like its date, and it is the one
   * number that tells somebody the writing was worth paying for.
   */
  const tally =
    zapCount > 0 ? (
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground tabular-nums">
          {totalSats.toLocaleString()}
        </span>{' '}
        sats from{' '}
        <span className="tabular-nums">{zapCount}</span>{' '}
        {zapCount === 1 ? 'reader' : 'readers'}
      </p>
    ) : null;

  /**
   * Nothing at all only when there is genuinely nothing to say: an author who
   * cannot be paid and has never been paid. A card explaining that would be a
   * paragraph about a missing feature at the end of somebody's writing.
   */
  if (!payable && zapCount === 0) return null;

  return (
    <div
      className={cn(
        'rounded-xl border bg-gradient-to-br from-zap/5 to-transparent p-5',
        className
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="h-11 w-11">
            <AvatarImage src={metadata?.picture} alt="" />
            <AvatarFallback>
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <p className="font-medium leading-tight">
              {isMine ? 'Your readers' : `Enjoyed this?`}
            </p>
            <p className="text-sm text-muted-foreground">
              {isMine
                ? 'What this article has earned so far.'
                : `Send ${displayName} some sats.`}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          {isLoading && zapCount === 0 ? (
            <p className="text-sm text-muted-foreground">Counting zaps…</p>
          ) : (
            tally
          )}

          {/*
            The reasons a zap is impossible are different from each other, and
            each has a different next step — log in, or nothing at all. Saying
            which beats a button that quietly is not there.
          */}
          {!isMine && payable && user && (
            <ZapDialog target={article}>
              <Button className="gap-2">
                <Zap className="h-4 w-4" />
                Zap this article
              </Button>
            </ZapDialog>
          )}

          {!isMine && payable && !user && (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">
                Log in to zap.
              </p>
              <LoginArea className="max-w-52" />
            </div>
          )}

          {!payable && (
            <p className="text-sm text-muted-foreground">
              {isMine
                ? 'Add a lightning address to your profile to receive zaps.'
                : `${displayName} has no lightning address yet.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
