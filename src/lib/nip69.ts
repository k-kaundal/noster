import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-69: peer-to-peer order events.
 *
 * A shared order book across p2p platforms. This client is a window onto it
 * and nothing more — orders are taken on the platform that published them, via
 * the `source` link. Nothing here escrows, matches or holds anything, which is
 * said plainly in the UI because a screen full of prices looks like an
 * exchange and this is a noticeboard.
 *
 * Two fields do not mean what their names suggest, and both are about money:
 * `amt` of `0` means "priced at market when taken", not zero sats; and
 * `expires_at` is when the order lapses, which is a different thing from the
 * `expiration` tag that tells relays to drop the event.
 */

export const ORDER_KIND = 38383;

export type OrderSide = 'sell' | 'buy';

export type OrderStatus =
  | 'pending'
  | 'canceled'
  | 'in-progress'
  | 'success'
  | 'expired';

const STATUSES = new Set<string>([
  'pending',
  'canceled',
  'in-progress',
  'success',
  'expired',
]);

export interface MakerRating {
  totalReviews?: number;
  totalRating?: number;
  lastRating?: number;
  maxRate?: number;
  minRate?: number;
}

export interface P2POrder {
  /** The `d` tag: the platform's own order id. */
  id: string;
  side: OrderSide;
  /** ISO 4217 code of the fiat side. */
  currency: string;
  status: OrderStatus;
  /**
   * Satoshis, or null when the order says `0` — which means the amount is
   * settled at market rate once somebody takes it, not that it is worth
   * nothing.
   */
  amountSats: number | null;
  /** Fiat amount. Two values on a range order. */
  fiatMin: number | null;
  fiatMax: number | null;
  paymentMethods: string[];
  /** Percentage over or under market. Can be negative. */
  premium: number | null;
  source?: string;
  rating?: MakerRating;
  network?: string;
  layer?: string;
  makerName?: string;
  geohash?: string;
  bondSats: number | null;
  /** When the order lapses, per the spec's `expires_at`. */
  expiresAt?: number;
  /** The platform that published it. */
  platform?: string;
  event: NostrEvent;
}

function firstValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([key]) => key === name)?.[1]?.trim() || undefined;
}

function readInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;

  const value = Number.parseFloat(raw.replace(/,/g, '').trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * Payment methods, in both shapes that exist.
 *
 * The spec's prose says a comma-separated list; its own example uses one tag
 * value per method. Both are in the wild, so both are read — a client that
 * only handled one would show "face to face, bank transfer" as a single
 * method, or drop every method after the first.
 */
export function parsePaymentMethods(event: NostrEvent): string[] {
  const tag = event.tags.find(([name]) => name === 'pm');
  if (!tag) return [];

  return [
    ...new Set(
      tag
        .slice(1)
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * The maker's rating, which arrives as JSON inside a tag value.
 *
 * Parsed defensively and dropped whole on any surprise. "This document does
 * not define how the rating is calculated" — so its shape is a convention
 * between platforms, and a number pulled out of a payload that turned out to
 * mean something else would be a reputation figure this client invented.
 */
export function parseRating(raw: string | undefined): MakerRating | undefined {
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return undefined;

    const num = (key: string) =>
      typeof parsed[key] === 'number' && Number.isFinite(parsed[key])
        ? (parsed[key] as number)
        : undefined;

    const rating: MakerRating = {
      totalReviews: num('total_reviews'),
      totalRating: num('total_rating'),
      lastRating: num('last_rating'),
      maxRate: num('max_rate'),
      minRate: num('min_rate'),
    };

    return Object.values(rating).some((value) => value !== undefined)
      ? rating
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseOrder(event: NostrEvent): P2POrder | null {
  if (event.kind !== ORDER_KIND) return null;

  /**
   * `z` discriminates the document type, and only `order` is this NIP. A
   * platform putting something else on the same kind should not have it
   * rendered as an offer to trade.
   */
  const document = firstValue(event, 'z');
  if (document && document.toLowerCase() !== 'order') return null;

  const id = firstValue(event, 'd');
  const side = firstValue(event, 'k')?.toLowerCase();
  const currency = firstValue(event, 'f')?.toUpperCase();
  const status = firstValue(event, 's')?.toLowerCase();

  // All four are mandatory, and an order missing any of them cannot be traded
  if (!id || (side !== 'sell' && side !== 'buy') || !currency) return null;
  if (!status || !STATUSES.has(status)) return null;

  const fiat = event.tags.find(([name]) => name === 'fa')?.slice(1) ?? [];
  const fiatValues = fiat
    .map((value) => readInt(value))
    .filter((value): value is number => value !== null);

  const amount = readInt(firstValue(event, 'amt'));

  return {
    id,
    side,
    currency,
    status: status as OrderStatus,
    // `0` is the sentinel for "settled at market rate", not an amount
    amountSats: amount === null || amount === 0 ? null : amount,
    fiatMin: fiatValues[0] ?? null,
    fiatMax: fiatValues.length > 1 ? fiatValues[1] : null,
    paymentMethods: parsePaymentMethods(event),
    premium: readInt(firstValue(event, 'premium')),
    source: firstValue(event, 'source'),
    rating: parseRating(firstValue(event, 'rating')),
    network: firstValue(event, 'network')?.toLowerCase(),
    layer: firstValue(event, 'layer')?.toLowerCase(),
    makerName: firstValue(event, 'name'),
    geohash: firstValue(event, 'g'),
    bondSats: readInt(firstValue(event, 'bond')),
    expiresAt: readInt(firstValue(event, 'expires_at')) ?? undefined,
    platform: firstValue(event, 'y'),
    event,
  };
}

/**
 * Whether an order can still be taken.
 *
 * `expires_at` is checked as well as the status, because the spec says the
 * status SHOULD be changed after it passes — which is a promise about the
 * publisher, not a guarantee about the event in hand. A bot that stopped
 * running leaves `pending` orders behind forever, and showing those as live
 * sends people to a platform to take something that lapsed weeks ago.
 */
export function isOpen(
  order: P2POrder,
  now: number = Math.floor(Date.now() / 1000)
): boolean {
  if (order.status !== 'pending') return false;
  return order.expiresAt === undefined || order.expiresAt > now;
}

/** The status to display, with a lapsed `pending` reported as expired. */
export function effectiveStatus(
  order: P2POrder,
  now: number = Math.floor(Date.now() / 1000)
): OrderStatus {
  if (
    order.status === 'pending' &&
    order.expiresAt !== undefined &&
    order.expiresAt <= now
  ) {
    return 'expired';
  }

  return order.status;
}

/**
 * The fiat side, written out.
 *
 * A range order has two numbers and must not be shown as one — "100 VES" for
 * an order that accepts 100 to 500 misstates what is on offer in the direction
 * that wastes a taker's time.
 */
export function formatFiat(order: P2POrder, locale?: string): string {
  if (order.fiatMin === null) return `— ${order.currency}`;

  const format = (value: number) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: order.currency,
        maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
      }).format(value);
    } catch {
      // Not an ISO code Intl knows; the code still belongs next to the number
      return `${value.toLocaleString(locale)} ${order.currency}`;
    }
  };

  return order.fiatMax !== null && order.fiatMax !== order.fiatMin
    ? `${format(order.fiatMin)} – ${format(order.fiatMax)}`
    : format(order.fiatMin);
}

/** The bitcoin side, or the fact that it is priced later. */
export function formatSats(order: P2POrder): string {
  return order.amountSats === null
    ? 'Market rate'
    : `${order.amountSats.toLocaleString()} sats`;
}

/** The premium, signed, since a negative one is a discount. */
export function formatPremium(order: P2POrder): string | null {
  if (order.premium === null || order.premium === 0) return null;

  const rounded = Math.round(order.premium * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

/** A 0–1 score from a maker's rating, when it carries enough to compute one. */
export function ratingFraction(rating: MakerRating): number | null {
  const { totalRating, maxRate, minRate } = rating;
  if (totalRating === undefined || maxRate === undefined) return null;

  const floor = minRate ?? 0;
  const span = maxRate - floor;
  if (span <= 0) return null;

  return Math.min(1, Math.max(0, (totalRating - floor) / span));
}

export interface OrderFilters {
  side?: OrderSide;
  currency?: string;
  /** Only orders that can still be taken. */
  openOnly?: boolean;
}

export function applyFilters(
  orders: P2POrder[],
  filters: OrderFilters,
  now: number = Math.floor(Date.now() / 1000)
): P2POrder[] {
  return orders.filter((order) => {
    if (filters.side && order.side !== filters.side) return false;
    if (
      filters.currency &&
      order.currency !== filters.currency.toUpperCase()
    ) {
      return false;
    }
    if (filters.openOnly && !isOpen(order, now)) return false;

    return true;
  });
}

/**
 * Currencies present in a set of orders, for a filter that offers only what
 * is actually there rather than a list of every ISO code.
 */
export function currenciesIn(orders: P2POrder[]): string[] {
  return [...new Set(orders.map((order) => order.currency))].sort();
}
