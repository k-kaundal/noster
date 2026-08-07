import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { BadgeCheck } from 'lucide-react';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { FollowButton } from '@/components/FollowButton';
import { useAuthor } from '@/hooks/useAuthor';
import { useFollowers } from '@/hooks/useFollowers';
import { useFollows } from '@/hooks/useFollows';
import { useIsMobile } from '@/hooks/useIsMobile';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface UserHoverCardProps {
  pubkey: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps a name or avatar so hovering previews the person.
 *
 * Skipped entirely on touch devices, where there is no hover and the card
 * would either never open or fight with the tap that follows the link.
 */
export function UserHoverCard({
  pubkey,
  children,
  className,
}: UserHoverCardProps) {
  const isMobile = useIsMobile();

  if (isMobile) return <>{children}</>;

  return (
    <HoverCard openDelay={350} closeDelay={150}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        align="start"
        className={cn('w-80 p-4', className)}
        // The trigger is usually a link; opening the card shouldn't follow it
        onClick={(event) => event.stopPropagation()}
      >
        <UserPreview pubkey={pubkey} />
      </HoverCardContent>
    </HoverCard>
  );
}

function UserPreview({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const npub = nip19.npubEncode(pubkey);

  // Only fetched once the card opens, so the feed doesn't pay for it
  const { followingList } = useFollows(pubkey);
  const { followerCount } = useFollowers(pubkey);

  if (author.isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    );
  }

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(pubkey);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/${npub}`} className="shrink-0">
          <Avatar className="h-12 w-12">
            <AvatarImage src={metadata?.picture} alt="" />
            <AvatarFallback>
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>

        <FollowButton pubkey={pubkey} />
      </div>

      <div className="space-y-0.5">
        <Link
          to={`/${npub}`}
          className="flex items-center gap-1.5 font-semibold hover:underline"
        >
          <span className="truncate">{displayName}</span>
          {metadata?.nip05 && (
            <BadgeCheck
              className="h-4 w-4 shrink-0 text-primary"
              aria-label="Has a verified Nostr address"
            />
          )}
        </Link>

        <p className="truncate text-xs text-muted-foreground">
          {metadata?.nip05 ?? `${npub.slice(0, 12)}…${npub.slice(-4)}`}
        </p>
      </div>

      {metadata?.about && (
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {metadata.about}
        </p>
      )}

      <div className="flex gap-4 text-sm">
        <Link to={`/${npub}/following`} className="hover:underline">
          <span className="font-semibold">{followingList.length}</span>{' '}
          <span className="text-muted-foreground">Following</span>
        </Link>
        <Link to={`/${npub}/followers`} className="hover:underline">
          <span className="font-semibold">{followerCount ?? 0}</span>{' '}
          <span className="text-muted-foreground">Followers</span>
        </Link>
      </div>
    </div>
  );
}
