import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { MessagesSquare } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { UserHoverCard } from '@/components/UserHoverCard';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { RENEWAL_WINDOW_DAYS, type Member } from '@/lib/subscription';
import { cn } from '@/lib/utils';

/**
 * One supporter, as the creator needs to see them.
 *
 * Three facts, in the order they are acted on: who, where they stand, and how
 * much they have given. The message button is the fourth — a lapsed supporter
 * is somebody to talk to rather than a row in a table, and there is nothing
 * else in the system that will contact them, since nothing here can bill.
 */
export function MemberRow({ member }: { member: Member }) {
  const author = useAuthor(member.pubkey);
  const metadata = author.data?.metadata;

  const name = metadata?.display_name || metadata?.name || genUserName(member.pubkey);
  const npub = nip19.npubEncode(member.pubkey);

  const { state, daysLeft, expiresAt, totalSats } = member.status;
  const soon =
    state === 'active' && daysLeft !== null && daysLeft <= RENEWAL_WINDOW_DAYS;

  /*
   * How long ago a lapsed period ended. A creator deciding who to write to
   * needs the difference between last week and last year, and "Lapsed" alone
   * flattens the two into one word.
   */
  const lapsedDays =
    state === 'lapsed' && expiresAt
      ? Math.max(Math.floor((Date.now() / 1000 - expiresAt) / 86_400), 0)
      : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <UserHoverCard pubkey={member.pubkey}>
        <Link to={`/${npub}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={metadata?.picture} alt="" className="object-cover" />
            <AvatarFallback className="text-[11px]">
              {name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name}</p>
            <p
              className={cn(
                'truncate text-xs',
                state === 'lapsed'
                  ? 'text-muted-foreground'
                  : soon
                    ? 'text-warning-strong'
                    : 'text-success-strong'
              )}
            >
              {state === 'active'
                ? soon
                  ? `Ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`
                  : `${daysLeft} days left`
                : lapsedDays === null
                  ? 'Lapsed'
                  : lapsedDays === 0
                    ? 'Lapsed today'
                    : `Lapsed ${lapsedDays} ${lapsedDays === 1 ? 'day' : 'days'} ago`}
            </p>
          </div>
        </Link>
      </UserHoverCard>

      <span className="shrink-0 tabular-nums text-sm text-zap">
        {totalSats.toLocaleString()}
      </span>

      <Button
        asChild
        variant="ghost"
        size="sm"
        className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
      >
        <Link to={`/chat/${npub}`} aria-label={`Message ${name}`}>
          <MessagesSquare className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
