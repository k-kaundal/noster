import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-99: classified listings.
 *
 * Structurally a NIP-23 article with money attached, and the money is where
 * the care goes. A price is three or four strings in a tag — amount, currency,
 * and optionally a period — and every one of them can be missing, malformed or
 * in a currency no formatter has heard of. A listing whose price renders as
 * `NaN`, or as dollars when it said satoshis, is worse than one that does not
 * render at all.
 */

/** Published and visible. */
export const LISTING_KIND = 30402;
/**
 * Draft or inactive.
 *
 * One kind for two states, which the spec does not distinguish — a listing
 * never published and one withdrawn after the fact look identical on the wire.
 * So nothing here claims to tell them apart; both mean "not on sale", which is
 * the part a reader needs.
 */
export const LISTING_DRAFT_KIND = 30403;

export type ListingStatus = 'active' | 'sold';

export interface ListingPrice {
  amount: number;
  /** As published — `USD`, `btc`, `sats`. Upper-cased only for display. */
  currency: string;
  /** `month`, `hour`, … when the price recurs. */
  frequency?: string;
}

export interface ListingImage {
  url: string;
  /** `"256x256"`, when the publisher gave one. */
  dimensions?: string;
}

export interface Listing {
  /** The `d` tag, which with the author addresses the listing. */
  slug: string;
  title: string;
  summary: string;
  /** Markdown. */
  content: string;
  images: ListingImage[];
  price?: ListingPrice;
  location?: string;
  /** Geohash, when a more precise location was given. */
  geohash?: string;
  status: ListingStatus;
  hashtags: string[];
  publishedAt: number;
  updatedAt: number;
  /** True for kind 30403 — a draft, or withdrawn. */
  isInactive: boolean;
  event: NostrEvent;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([key]) => key === name)?.[1]?.trim() || undefined;
}

/**
 * Reads the `price` tag.
 *
 * Returns null rather than a zero when the amount will not parse. Zero is a
 * real price — plenty of listings are giveaways — so defaulting to it would
 * turn a broken tag into a claim that something is free.
 */
export function parsePrice(event: NostrEvent): ListingPrice | null {
  const tag = event.tags.find(([name]) => name === 'price');
  if (!tag) return null;

  const [, rawAmount, rawCurrency, rawFrequency] = tag;

  /**
   * Thousands separators are stripped, decimal points kept. Publishers do
   * write "50,000" despite the spec asking for a bare number, and
   * `Number.parseFloat` reads that as 50.
   */
  const amount = Number.parseFloat((rawAmount ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(amount) || amount < 0) return null;

  const currency = rawCurrency?.trim();
  if (!currency) return null;

  return {
    amount,
    currency,
    frequency: rawFrequency?.trim().toLowerCase() || undefined,
  };
}

/**
 * A price, written out.
 *
 * `Intl` handles real ISO 4217 codes and throws on anything else — including
 * `sats`, which is four letters and exactly the sort of "ISO 4217-like" code
 * the spec permits. The throw is caught rather than avoided by a whitelist,
 * because the set of codes `Intl` knows differs between browsers.
 */
export function formatPrice(
  price: ListingPrice,
  locale?: string
): string {
  let amount: string;

  try {
    amount = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: price.currency,
      // Whole units stay whole: "100 sats", not "100.00 sats"
      maximumFractionDigits: Number.isInteger(price.amount) ? 0 : 8,
    }).format(price.amount);
  } catch {
    amount = `${price.amount.toLocaleString(locale)} ${price.currency.toUpperCase()}`;
  }

  return price.frequency ? `${amount} / ${price.frequency}` : amount;
}

/** NIP-58 style `["image", url, dimensions?]` tags. */
function parseImages(event: NostrEvent): ListingImage[] {
  return event.tags
    .filter(([name, url]) => name === 'image' && !!url?.trim())
    .map(([, url, dimensions]) => ({
      url: url.trim(),
      dimensions: dimensions?.trim() || undefined,
    }));
}

export function parseListing(event: NostrEvent): Listing | null {
  if (event.kind !== LISTING_KIND && event.kind !== LISTING_DRAFT_KIND) {
    return null;
  }

  const slug = tagValue(event, 'd');
  if (!slug) return null;

  const published = Number.parseInt(tagValue(event, 'published_at') ?? '', 10);
  const status = tagValue(event, 'status')?.toLowerCase();

  return {
    slug,
    title: tagValue(event, 'title') || 'Untitled listing',
    summary: tagValue(event, 'summary') || '',
    content: event.content,
    images: parseImages(event),
    price: parsePrice(event) ?? undefined,
    location: tagValue(event, 'location'),
    geohash: tagValue(event, 'g'),
    /**
     * Optional, and anything other than `sold` reads as still for sale — a
     * listing with a typo'd status should stay visible rather than disappear
     * into a state nothing displays.
     */
    status: status === 'sold' ? 'sold' : 'active',
    hashtags: event.tags
      .filter(([name, value]) => name === 't' && !!value?.trim())
      .map(([, value]) => value.trim().toLowerCase()),
    publishedAt:
      Number.isFinite(published) && published > 0 ? published : event.created_at,
    updatedAt: event.created_at,
    isInactive: event.kind === LISTING_DRAFT_KIND,
    event,
  };
}

export interface ListingInput {
  slug: string;
  title: string;
  summary?: string;
  content: string;
  price?: ListingPrice;
  location?: string;
  geohash?: string;
  images?: ListingImage[];
  hashtags?: string[];
  status?: ListingStatus;
  /** Kept from the original event when editing, so it survives revisions. */
  publishedAt?: number;
}

export function buildListingTags(
  input: ListingInput,
  now: number = Math.floor(Date.now() / 1000)
): string[][] {
  const tags: string[][] = [
    ['d', input.slug],
    ['title', input.title.trim()],
    /**
     * First publication, not this revision. Carried through edits so a listing
     * corrected a week later does not jump to the top of a feed sorted by age
     * as though it were new.
     */
    ['published_at', String(input.publishedAt ?? now)],
  ];

  if (input.summary?.trim()) tags.push(['summary', input.summary.trim()]);

  if (input.price) {
    const price = [
      'price',
      String(input.price.amount),
      input.price.currency.trim(),
    ];

    if (input.price.frequency?.trim()) {
      price.push(input.price.frequency.trim().toLowerCase());
    }

    tags.push(price);
  }

  if (input.location?.trim()) tags.push(['location', input.location.trim()]);
  if (input.geohash?.trim()) tags.push(['g', input.geohash.trim()]);

  for (const image of input.images ?? []) {
    if (!image.url.trim()) continue;
    tags.push(
      image.dimensions
        ? ['image', image.url.trim(), image.dimensions]
        : ['image', image.url.trim()]
    );
  }

  for (const tag of new Set(
    (input.hashtags ?? []).map((value) => value.trim().toLowerCase())
  )) {
    if (tag) tags.push(['t', tag]);
  }

  if (input.status) tags.push(['status', input.status]);

  return tags;
}

/**
 * A `d` value from a title.
 *
 * Only used for new listings. Changing it on an edit would publish a second
 * listing rather than revise the first, leaving the old one on relays with no
 * way for its author to withdraw it.
 */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');

  // A title of only punctuation or non-Latin script leaves nothing behind
  return slug || `listing-${Date.now().toString(36)}`;
}

/** Currencies offered in the composer. Free text is still allowed. */
export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'INR',
  'BRL',
  'NGN',
  'BTC',
  'SATS',
];

/** Recurring-payment periods, as nouns per the spec. */
export const PRICE_FREQUENCIES = [
  'hour',
  'day',
  'week',
  'month',
  'year',
];
