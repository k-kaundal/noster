import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-87: finding an ecash mint, and saying which one you trust.
 *
 * Choosing a mint is the one decision in a Cashu wallet that can lose all the
 * money in it — a mint holds the backing funds, and a mint that vanishes takes
 * them. There is no way to verify one from a browser, so what this NIP offers
 * instead is the only signal that has ever worked for custody: who else is
 * keeping money there, and whether you know them.
 *
 * That is why the recommendation query is scoped to a follow list rather than
 * run open across relays. The spec is explicit about the alternative —
 * "Clients SHOULD be careful doing this and use spam-prevention mechanisms" —
 * because an unfiltered list of self-announced mints is a list of whoever
 * published most, presented to someone about to deposit money.
 */

/** Announcement published by a Cashu mint operator. */
export const CASHU_MINT_KIND = 38172;
/** Announcement published by a Fedimint. */
export const FEDIMINT_KIND = 38173;
/** Somebody vouching for one of the above. */
export const RECOMMENDATION_KIND = 38000;

export type MintKind = typeof CASHU_MINT_KIND | typeof FEDIMINT_KIND;

export type Network = 'mainnet' | 'testnet' | 'signet' | 'regtest';

const NETWORKS = new Set<string>(['mainnet', 'testnet', 'signet', 'regtest']);

export interface MintAnnouncement {
  kind: MintKind;
  /** The mint's own pubkey (Cashu) or federation id (Fedimint). */
  id: string;
  /** Mint URLs, or Fedimint invite codes. */
  urls: string[];
  /** NUT numbers a Cashu mint says it implements. */
  nuts: number[];
  /** Module names a Fedimint says it runs. */
  modules: string[];
  network?: Network;
  /** kind:0-style metadata from `content`, when the operator supplied any. */
  metadata: MintMetadata | null;
  event: NostrEvent;
}

export interface MintMetadata {
  name?: string;
  about?: string;
  picture?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
}

export interface MintRecommendation {
  /** Who is vouching. */
  pubkey: string;
  /** The `d` of the announcement being recommended. */
  target: string;
  /** Which kind is being recommended, from the `k` tag. */
  kind: MintKind;
  /** Ways to connect that the recommender suggests. */
  urls: string[];
  /** `kind:pubkey:d` coordinates, with relay hints where given. */
  addresses: { coordinate: string; relay?: string }[];
  /** Free-text review. */
  review: string;
  createdAt: number;
  event: NostrEvent;
}

function tagValues(event: NostrEvent, name: string): string[] {
  return event.tags
    .filter(([key, value]) => key === name && !!value)
    .map(([, value]) => value.trim())
    .filter(Boolean);
}

function firstTag(event: NostrEvent, name: string): string | undefined {
  return tagValues(event, name)[0];
}

/**
 * Parses `["nuts", "1,2,3,4,5,6,7"]`.
 *
 * One comma-joined tag is what the spec shows, but the same list turns up
 * split across several tags in the wild, so both are accumulated rather than
 * only the first being read.
 */
function parseNuts(event: NostrEvent): number[] {
  const numbers = tagValues(event, 'nuts')
    .flatMap((value) => value.split(','))
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry >= 0);

  return [...new Set(numbers)].sort((a, b) => a - b);
}

function parseModules(event: NostrEvent): string[] {
  const names = tagValues(event, 'modules')
    .flatMap((value) => value.split(','))
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(names)];
}

/**
 * Optional kind:0-style metadata in `content`.
 *
 * "If `content` is empty, the `kind:0` of the pubkey should be used" — so an
 * absent object means fall back to the author's profile, which is a different
 * thing from an object with no useful fields in it. Null says which.
 */
function parseMetadata(content: string): MintMetadata | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const pick = (key: string) => {
      const value = (parsed as Record<string, unknown>)[key];
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };

    return {
      name: pick('name') ?? pick('display_name'),
      about: pick('about'),
      picture: pick('picture'),
      website: pick('website'),
      nip05: pick('nip05'),
      lud16: pick('lud16'),
    };
  } catch {
    return null;
  }
}

export function parseMintAnnouncement(
  event: NostrEvent
): MintAnnouncement | null {
  if (event.kind !== CASHU_MINT_KIND && event.kind !== FEDIMINT_KIND) {
    return null;
  }

  const id = firstTag(event, 'd');
  if (!id) return null;

  const urls = tagValues(event, 'u');

  /**
   * An announcement with no way to reach the mint is not usable. It parses,
   * it is well-formed, and acting on it means offering somebody a mint this
   * client cannot connect them to — so it is dropped here rather than
   * rendered as a choice that fails on click.
   */
  if (!urls.length) return null;

  const network = firstTag(event, 'n')?.toLowerCase();

  return {
    kind: event.kind as MintKind,
    id,
    urls,
    nuts: parseNuts(event),
    modules: parseModules(event),
    network: network && NETWORKS.has(network) ? (network as Network) : undefined,
    metadata: parseMetadata(event.content),
    event,
  };
}

export function parseRecommendation(
  event: NostrEvent
): MintRecommendation | null {
  if (event.kind !== RECOMMENDATION_KIND) return null;

  const target = firstTag(event, 'd');
  if (!target) return null;

  /**
   * The `k` tag says which kind is being recommended. Without it there is no
   * telling a Cashu recommendation from a Fedimint one, and showing a
   * federation invite code to a Cashu wallet is a dead end — so an untagged
   * recommendation is read from its `a` tags if they agree, and dropped if
   * they do not.
   */
  const declared = Number.parseInt(firstTag(event, 'k') ?? '', 10);

  const addresses = event.tags
    .filter(([name, value]) => name === 'a' && !!value)
    .map(([, coordinate, relay]) => ({
      coordinate: coordinate.trim(),
      relay: relay?.trim() || undefined,
    }));

  const fromAddresses = [
    ...new Set(
      addresses
        .map((entry) => Number.parseInt(entry.coordinate.split(':')[0], 10))
        .filter((value) => value === CASHU_MINT_KIND || value === FEDIMINT_KIND)
    ),
  ];

  const kind =
    declared === CASHU_MINT_KIND || declared === FEDIMINT_KIND
      ? declared
      : fromAddresses.length === 1
        ? fromAddresses[0]
        : null;

  if (kind === null) return null;

  return {
    pubkey: event.pubkey,
    target,
    kind: kind as MintKind,
    urls: tagValues(event, 'u'),
    addresses,
    review: event.content.trim(),
    createdAt: event.created_at,
    event,
  };
}

/** The `kind:pubkey:d` coordinate of an announcement. */
export function announcementCoordinate(announcement: MintAnnouncement): string {
  return `${announcement.kind}:${announcement.event.pubkey}:${announcement.id}`;
}

export interface RecommendationInput {
  /** The announcement being vouched for, when one was found. */
  announcement?: MintAnnouncement;
  /** The mint's id — its pubkey for Cashu — used as `d`. */
  target: string;
  kind: MintKind;
  urls: string[];
  relayHint?: string;
}

/**
 * The tags for a kind 38000.
 *
 * Addressable, so `d` identifies which mint is being recommended and a second
 * recommendation of the same mint replaces the first rather than stacking. The
 * `d` is the announcement's identifier "if no event exists, the `d` tag can
 * still be calculated from the mint's pubkey/id" — which is why this takes a
 * target rather than requiring an announcement to have been found.
 */
export function buildRecommendationTags(
  input: RecommendationInput
): string[][] {
  const tags: string[][] = [
    ['d', input.target],
    ['k', String(input.kind)],
  ];

  for (const url of [...new Set(input.urls)].filter(Boolean)) {
    tags.push(['u', url]);
  }

  if (input.announcement) {
    const coordinate = announcementCoordinate(input.announcement);
    tags.push(
      input.relayHint ? ['a', coordinate, input.relayHint] : ['a', coordinate]
    );
  }

  return tags;
}

/** What to call a mint on screen. */
export function mintDisplayName(announcement: MintAnnouncement): string {
  const named = announcement.metadata?.name;
  if (named) return named;

  const [url] = announcement.urls;

  try {
    return new URL(url).host;
  } catch {
    // A Fedimint invite code is not a URL, and neither is a malformed entry
    return url.length > 24 ? `${url.slice(0, 21)}…` : url;
  }
}

export interface RankedMint {
  announcement: MintAnnouncement;
  /** Who recommended it, deduplicated. */
  recommenders: string[];
  reviews: MintRecommendation[];
}

/**
 * Mints ordered by how many people vouched for them.
 *
 * Count of distinct recommenders, not of events: kind 38000 is addressable, so
 * one person can hold recommendations for several mints, and a mint could
 * otherwise be ranked up by a single enthusiastic account.
 */
export function rankMints(
  announcements: MintAnnouncement[],
  recommendations: MintRecommendation[]
): RankedMint[] {
  const byTarget = new Map<string, MintRecommendation[]>();

  for (const recommendation of recommendations) {
    const existing = byTarget.get(recommendation.target) ?? [];
    existing.push(recommendation);
    byTarget.set(recommendation.target, existing);
  }

  return announcements
    .map((announcement) => {
      const reviews = byTarget.get(announcement.id) ?? [];

      return {
        announcement,
        recommenders: [...new Set(reviews.map((entry) => entry.pubkey))],
        reviews: reviews.filter((entry) => !!entry.review),
      };
    })
    .sort((a, b) => b.recommenders.length - a.recommenders.length);
}
