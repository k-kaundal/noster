import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Award, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useBadgeAwards,
  useProfileBadgeActions,
  useProfileBadges,
} from '@/hooks/useBadges';
import { genUserName } from '@/lib/genUserName';
import { badgeName, pickBadgeImage, type DisplayBadge } from '@/lib/nip58';
import { cn } from '@/lib/utils';

/**
 * The badges someone put on their profile.
 *
 * In the order they chose, which is the only ranking the format expresses.
 * Everything here has been checked — the award names this person and is for
 * the badge it is shown as — because an unverified badge is a claim anybody
 * can make about anybody.
 */
export function ProfileBadges({
  pubkey,
  className,
}: {
  pubkey: string;
  className?: string;
}) {
  const { badges, isLoading } = useProfileBadges(pubkey);

  if (isLoading) {
    return (
      <div className={cn('flex gap-2', className)}>
        <Skeleton className="h-10 w-10 rounded-lg" />
        <Skeleton className="h-10 w-10 rounded-lg" />
      </div>
    );
  }

  if (!badges.length) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {badges.map((badge) => (
        <BadgeChip key={badge.definition.address} badge={badge} />
      ))}
    </div>
  );
}

/**
 * One badge, small, opening to its full-size self.
 *
 * "Clients SHOULD attempt render the high-res version on user action" — so the
 * grid uses a thumbnail sized for the slot and the dialog uses the real image.
 */
function BadgeChip({ badge }: { badge: DisplayBadge }) {
  const { definition } = badge;
  const issuer = useAuthor(definition.issuer);
  const metadata = issuer.data?.metadata;

  const issuerName =
    metadata?.name || metadata?.display_name || genUserName(definition.issuer);

  const thumb = pickBadgeImage(definition, 64);
  const full = definition.image?.url ?? thumb;
  const name = badgeName(definition);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded-lg transition-transform hover:scale-105"
          aria-label={name}
        >
          {thumb ? (
            <img
              src={thumb}
              alt={name}
              loading="lazy"
              className="h-10 w-10 rounded-lg object-cover"
            />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Award className="h-5 w-5 text-muted-foreground" />
            </span>
          )}
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-center">
          {full && (
            <img
              src={full}
              alt=""
              className="mx-auto h-40 w-40 rounded-2xl object-cover"
            />
          )}

          {definition.description && (
            <p className="text-sm text-muted-foreground">
              {definition.description}
            </p>
          )}

          {/*
            Who issued it is the whole value of a badge. A medal from someone
            you have never heard of means what their reputation means.
          */}
          <p className="text-sm">
            Issued by{' '}
            <Link
              to={`/${nip19.npubEncode(definition.issuer)}`}
              className="font-medium text-primary hover:underline"
            >
              {issuerName}
            </Link>
          </p>

          <p className="text-xs text-muted-foreground">
            Awarded{' '}
            {new Date(badge.award.event.created_at * 1000).toLocaleDateString()}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Badges offered to you, and the ones you are showing.
 *
 * Awards need no consent to publish, so this is the consent step: nothing
 * reaches a profile until its owner puts it there.
 */
export function BadgeSettings({ className }: { className?: string }) {
  const { user } = useCurrentUser();
  const { badges } = useProfileBadges(user?.pubkey);
  const { pending, isLoading } = useBadgeAwards();
  const { accept, isAccepting, remove, isRemoving } = useProfileBadgeActions();

  if (!user) return null;
  if (!isLoading && !badges.length && !pending.length) return null;

  return (
    <div className={cn('space-y-4', className)}>
      {badges.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">On your profile</p>
          <ul className="space-y-2">
            {badges.map((badge) => (
              <li
                key={badge.definition.address}
                className="flex items-center gap-3 rounded-lg border p-2"
              >
                <BadgeRow badge={badge} />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isRemoving}
                  onClick={() => remove(badge)}
                  aria-label={`Remove ${badgeName(badge.definition)}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Awarded to you</p>
          <p className="text-xs text-muted-foreground">
            Anyone can award a badge to anyone, so none of these appear until
            you add them.
          </p>
          <ul className="space-y-2">
            {pending.map((badge) => (
              <li
                key={badge.definition.address}
                className="flex items-center gap-3 rounded-lg border border-dashed p-2"
              >
                <BadgeRow badge={badge} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isAccepting}
                  onClick={() => accept(badge)}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BadgeRow({ badge }: { badge: DisplayBadge }) {
  const issuer = useAuthor(badge.definition.issuer);
  const metadata = issuer.data?.metadata;
  const thumb = pickBadgeImage(badge.definition, 32);

  return (
    <>
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="h-8 w-8 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Award className="h-4 w-4 text-muted-foreground" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {badgeName(badge.definition)}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          from{' '}
          {metadata?.name ||
            metadata?.display_name ||
            genUserName(badge.definition.issuer)}
        </p>
      </div>
    </>
  );
}
