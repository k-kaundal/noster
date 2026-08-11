import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { ImageOff, MapPin } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { MaybeWarned } from '@/components/ContentWarning';
import { useAuthor } from '@/hooks/useAuthor';
import { readContentWarning } from '@/lib/contentWarning';
import { genUserName } from '@/lib/genUserName';
import { formatPrice, type Listing } from '@/lib/nip99';
import { markdownToText } from '@/lib/markdown';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';

/** A listing in a grid. */
export function ListingCard({
  listing,
  className,
}: {
  listing: Listing;
  className?: string;
}) {
  const author = useAuthor(listing.event.pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(listing.event.pubkey);

  const naddr = nip19.naddrEncode({
    kind: listing.event.kind,
    pubkey: listing.event.pubkey,
    identifier: listing.slug,
  });

  const warning = readContentWarning(listing.event);
  const [cover] = listing.images;
  const preview =
    listing.summary || markdownToText(listing.content).slice(0, 140);

  return (
    <Card className={cn('content-auto overflow-hidden hover-lift', className)}>
      <Link to={`/${naddr}`} className="block">
        <div className="relative">
          {cover ? (
            <MaybeWarned event={listing.event} warning={warning} opaque>
              <img
                src={cover.url}
                alt=""
                loading="lazy"
                className="h-44 w-full object-cover"
              />
            </MaybeWarned>
          ) : (
            <div className="flex h-44 w-full items-center justify-center bg-muted">
              <ImageOff className="h-6 w-6 text-muted-foreground" />
            </div>
          )}

          {/*
            Over the image rather than beside the price: a sold listing that
            reads as available wastes the time of everyone who clicks it.
          */}
          {listing.status === 'sold' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Badge variant="secondary" className="text-sm">
                Sold
              </Badge>
            </div>
          )}

          {listing.isInactive && (
            <Badge
              variant="outline"
              className="absolute left-2 top-2 bg-background/90"
            >
              Not published
            </Badge>
          )}
        </div>

        <div className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 min-w-0 font-medium leading-snug">
              {listing.title}
            </h3>
            {listing.price && (
              <span className="shrink-0 whitespace-nowrap font-semibold text-primary">
                {formatPrice(listing.price)}
              </span>
            )}
          </div>

          {preview && !warning && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {preview}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Avatar className="h-4 w-4">
                <AvatarImage src={metadata?.picture} alt="" />
                <AvatarFallback className="text-[8px]">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{displayName}</span>
            </span>

            {listing.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {listing.location}
              </span>
            )}

            <span className="ml-auto shrink-0">
              {timeAgo(listing.publishedAt * 1000)}
            </span>
          </div>
        </div>
      </Link>
    </Card>
  );
}
