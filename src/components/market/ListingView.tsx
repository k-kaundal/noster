import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { MapPin, Tag } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Markdown } from '@/components/articles/Markdown';
import { MaybeWarned } from '@/components/ContentWarning';
import { UserHoverCard } from '@/components/UserHoverCard';
import { ZapButton } from '@/components/ZapButton';
import { CommentsSection } from '@/components/comments/CommentsSection';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useListingActions } from '@/hooks/useListings';
import { useSeo } from '@/hooks/useSeo';
import { readContentWarning } from '@/lib/contentWarning';
import { genUserName } from '@/lib/genUserName';
import { markdownToText } from '@/lib/markdown';
import { formatPrice, type Listing } from '@/lib/nip99';
import { cn } from '@/lib/utils';

/** A whole listing. */
export function ListingView({ listing }: { listing: Listing }) {
  const { user } = useCurrentUser();
  const author = useAuthor(listing.event.pubkey);
  const metadata = author.data?.metadata;
  const { markSold, isMarkingSold } = useListingActions();

  const [shown, setShown] = useState(0);

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(listing.event.pubkey);
  const npub = nip19.npubEncode(listing.event.pubkey);
  const isMine = user?.pubkey === listing.event.pubkey;
  const warning = readContentWarning(listing.event);

  useSeo({
    title: listing.title,
    description:
      listing.summary || markdownToText(listing.content).slice(0, 200),
    image: listing.images[0]?.url,
    path: `/${nip19.naddrEncode({
      kind: listing.event.kind,
      pubkey: listing.event.pubkey,
      identifier: listing.slug,
    })}`,
  });

  const cover = listing.images[shown];

  return (
    <div className="space-y-6">
      {cover && (
        <div className="space-y-2">
          <MaybeWarned event={listing.event} warning={warning} opaque>
            <img
              src={cover.url}
              alt=""
              className="max-h-[460px] w-full rounded-2xl border object-cover"
            />
          </MaybeWarned>

          {/* A carousel is what `image` tags are for, per the NIP */}
          {listing.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {listing.images.map((image, index) => (
                <button
                  key={image.url}
                  type="button"
                  onClick={() => setShown(index)}
                  className={cn(
                    'h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors',
                    index === shown ? 'border-primary' : 'border-transparent'
                  )}
                  aria-label={`Image ${index + 1}`}
                >
                  <img
                    src={image.url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">
              {listing.title}
            </h1>
            {listing.summary && (
              <p className="text-muted-foreground">{listing.summary}</p>
            )}
          </div>

          <div className="shrink-0 text-right">
            {listing.price ? (
              <p className="text-2xl font-semibold text-primary">
                {formatPrice(listing.price)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No price given</p>
            )}
            {listing.status === 'sold' && (
              <Badge variant="secondary" className="mt-1">
                Sold
              </Badge>
            )}
          </div>
        </div>

        {listing.isInactive && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            This one isn't published — it is a draft, or it was taken down.
            Nobody browsing the market will find it.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-y py-3 text-sm">
          <UserHoverCard pubkey={listing.event.pubkey}>
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

          {listing.location && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {listing.location}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {isMine && listing.status !== 'sold' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => markSold(listing)}
                disabled={isMarkingSold}
              >
                Mark as sold
              </Button>
            )}
            {/*
              A zap is the one payment rail this client can actually offer.
              NIP-99 says nothing about how money changes hands — that is
              between the two people — so nothing here pretends to escrow it.
            */}
            {!isMine && <ZapButton target={listing.event} />}
          </div>
        </div>
      </header>

      <MaybeWarned event={listing.event} warning={warning}>
        <Markdown source={listing.content} />
      </MaybeWarned>

      {listing.hashtags.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t pt-5">
          {listing.hashtags.map((tag) => (
            <Link key={tag} to={`/market?t=${encodeURIComponent(tag)}`}>
              <Badge variant="outline" className="gap-1">
                <Tag className="h-3 w-3" />
                {tag}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Arrange payment and delivery with the seller directly. Nothing here
        holds funds or verifies anyone — treat it like a noticeboard.
      </p>

      <Card className="p-4 sm:p-5">
        <CommentsSection
          root={listing.event}
          title="Questions"
          emptyStateMessage="No questions yet"
          emptyStateSubtitle="Ask the seller anything about this listing."
        />
      </Card>
    </div>
  );
}
