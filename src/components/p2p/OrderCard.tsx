import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  MapPin,
  Shield,
  Star,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  effectiveStatus,
  formatFiat,
  formatPremium,
  formatSats,
  ratingFraction,
  type OrderStatus,
  type P2POrder,
} from '@/lib/nip69';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: 'bg-success/15 text-success-strong',
  'in-progress': 'bg-warning/15 text-warning-strong',
  success: 'bg-muted text-muted-foreground',
  canceled: 'bg-muted text-muted-foreground',
  expired: 'bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Open',
  'in-progress': 'In progress',
  success: 'Completed',
  canceled: 'Cancelled',
  expired: 'Expired',
};

/**
 * One order in the book.
 *
 * `side` is written from the maker's point of view, as the tag is — an order
 * tagged `sell` is somebody selling bitcoin, which means the reader would be
 * buying. Restating it as "you buy" reads more helpfully and is how order
 * books get shown backwards, so the maker's word is kept and the direction is
 * said in full.
 */
export function OrderCard({
  order,
  className,
}: {
  order: P2POrder;
  className?: string;
}) {
  const status = effectiveStatus(order);
  const premium = formatPremium(order);
  const isSelling = order.side === 'sell';

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                isSelling ? 'bg-primary/10' : 'bg-muted'
              )}
            >
              {isSelling ? (
                <ArrowUpRight className="h-4 w-4 text-primary" />
              ) : (
                <ArrowDownLeft className="h-4 w-4 text-muted-foreground" />
              )}
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {order.makerName || 'Anonymous'}
                {order.platform && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    on {order.platform}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {isSelling ? 'Selling bitcoin' : 'Buying bitcoin'} ·{' '}
                {relativeTime(order.event.created_at * 1000)}
              </p>
            </div>
          </div>

          <Badge className={cn('shrink-0', STATUS_STYLE[status])} variant="secondary">
            {STATUS_LABEL[status]}
          </Badge>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-lg font-semibold">{formatFiat(order)}</span>
          <span className="text-sm text-muted-foreground">
            for {formatSats(order)}
          </span>
          {premium && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="font-normal">
                  {premium}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {order.premium! > 0
                  ? 'Above the market rate.'
                  : 'Below the market rate.'}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {order.paymentMethods.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {order.paymentMethods.slice(0, 6).map((method) => (
              <Badge key={method} variant="secondary" className="font-normal">
                {method}
              </Badge>
            ))}
            {order.paymentMethods.length > 6 && (
              <Badge variant="outline" className="font-normal">
                +{order.paymentMethods.length - 6}
              </Badge>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {order.layer && <span>{order.layer}</span>}

          {/*
            A testnet order trades coins with no value. Loud, because the card
            is otherwise identical to a real one.
          */}
          {order.network && order.network !== 'mainnet' && (
            <Badge variant="outline" className="text-[10px] text-warning-strong">
              {order.network} — not real bitcoin
            </Badge>
          )}

          {order.bondSats !== null && order.bondSats > 0 && (
            <span className="flex items-center gap-1">
              <Shield className="h-3 w-3" />
              {order.bondSats.toLocaleString()} sats bond
            </span>
          )}

          {order.geohash && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              in person
            </span>
          )}

          <MakerRatingChip order={order} />
        </div>

        {order.source ? (
          <a
            href={order.source}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            Take this on {order.platform || 'their platform'}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <p className="text-xs text-muted-foreground">
            No link to take this order — find it on {order.platform ?? 'the platform that published it'}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MakerRatingChip({ order }: { order: P2POrder }) {
  const rating = order.rating;
  if (!rating) return null;

  const fraction = ratingFraction(rating);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1">
          <Star className="h-3 w-3" />
          {rating.totalRating !== undefined
            ? `${rating.totalRating}${rating.maxRate ? `/${rating.maxRate}` : ''}`
            : `${rating.totalReviews ?? 0} reviews`}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {/*
          The NIP is explicit that it does not define how a rating is
          calculated, so this cannot be compared across platforms — and a
          number that looks comparable will be compared.
        */}
        {order.platform ?? 'The publishing platform'} works this out its own
        way; NIP-69 does not define it, so it means nothing next to a score
        from anywhere else.
        {rating.totalReviews !== undefined && (
          <span className="mt-1 block text-muted-foreground">
            {rating.totalReviews} review{rating.totalReviews === 1 ? '' : 's'}
            {fraction !== null && ` · ${Math.round(fraction * 100)}%`}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
