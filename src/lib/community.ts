import type { NostrEvent } from '@nostrify/nostrify';

/** NIP-72 moderated communities. */
export const COMMUNITY_KIND = 34550;
/** A moderator's approval of one post, which is what makes it visible. */
export const APPROVAL_KIND = 4550;

export interface Community {
  /** The `d` tag, which with the author addresses the community. */
  slug: string;
  name: string;
  description: string;
  image?: string;
  /** Who created it. Always a moderator, whether or not they tagged themselves. */
  creator: string;
  /** Pubkeys allowed to approve posts, including the creator. */
  moderators: string[];
  /** Relays the community asks members to use, by purpose. */
  relays: { url: string; marker?: string }[];
  createdAt: number;
  event: NostrEvent;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([key]) => key === name)?.[1] || undefined;
}

/**
 * Reads a community definition.
 *
 * The creator is folded into the moderator list whether or not they tagged
 * themselves. NIP-72 expects a `p` tag with the `moderator` marker, but a
 * definition written without one would otherwise describe a community nobody
 * can moderate — including the person who made it.
 */
export function parseCommunity(event: NostrEvent): Community | null {
  if (event.kind !== COMMUNITY_KIND) return null;

  const slug = tagValue(event, 'd');
  if (!slug) return null;

  const moderators = new Set<string>([event.pubkey]);
  for (const [name, value, , marker] of event.tags) {
    if (name === 'p' && value && marker === 'moderator') moderators.add(value);
  }

  return {
    slug,
    name: tagValue(event, 'name') || slug,
    description: tagValue(event, 'description') || '',
    image: tagValue(event, 'image'),
    creator: event.pubkey,
    moderators: [...moderators],
    relays: event.tags
      .filter(([name, value]) => name === 'relay' && !!value)
      .map(([, url, marker]) => ({ url, marker: marker || undefined })),
    createdAt: event.created_at,
    event,
  };
}

/** The `kind:pubkey:d` coordinate that posts and approvals point at. */
export function communityAddress(community: {
  creator: string;
  slug: string;
}): string {
  return `${COMMUNITY_KIND}:${community.creator}:${community.slug}`;
}

/** Splits a `kind:pubkey:identifier` coordinate back into its parts. */
export function parseAddress(
  address: string
): { kind: number; pubkey: string; identifier: string } | null {
  const [kind, pubkey, ...rest] = address.split(':');
  const parsedKind = Number(kind);

  // An identifier may itself contain colons, so the tail is rejoined
  if (!Number.isFinite(parsedKind) || !pubkey) return null;

  return { kind: parsedKind, pubkey, identifier: rest.join(':') };
}

export interface CommunityDraft {
  slug: string;
  name: string;
  description: string;
  image?: string;
  /** Moderators besides the creator. */
  moderators: string[];
  relays: string[];
}

/** The tags for a NIP-72 community definition. */
export function buildCommunityTags(draft: CommunityDraft): string[][] {
  const tags: string[][] = [['d', draft.slug]];

  if (draft.name.trim()) tags.push(['name', draft.name.trim()]);
  if (draft.description.trim()) {
    tags.push(['description', draft.description.trim()]);
  }
  if (draft.image?.trim()) tags.push(['image', draft.image.trim()]);

  const seen = new Set<string>();
  for (const pubkey of draft.moderators) {
    const clean = pubkey.trim().toLowerCase();
    // 64 hex characters, because a malformed pubkey silently grants nobody
    if (/^[0-9a-f]{64}$/.test(clean) && !seen.has(clean)) {
      seen.add(clean);
      tags.push(['p', clean, '', 'moderator']);
    }
  }

  for (const url of draft.relays) {
    const clean = url.trim();
    if (clean) tags.push(['relay', clean]);
  }

  return tags;
}

/** True when this pubkey may approve posts in the community. */
export function canModerate(
  community: Community | null | undefined,
  pubkey: string | undefined
): boolean {
  if (!community || !pubkey) return false;
  return community.moderators.includes(pubkey);
}

/**
 * The set of post ids a community's moderators have approved.
 *
 * NIP-72 is approval-based: anyone may address a post to a community, and it
 * belongs there only once a moderator says so. Approvals from anyone else are
 * ignored, otherwise a spammer could approve their own posts.
 */
export function approvedPostIds(
  approvals: NostrEvent[],
  moderators: string[]
): Set<string> {
  const allowed = new Set(moderators);
  const ids = new Set<string>();

  for (const approval of approvals) {
    if (approval.kind !== APPROVAL_KIND) continue;
    if (!allowed.has(approval.pubkey)) continue;

    for (const [name, value] of approval.tags) {
      if (name === 'e' && value) ids.add(value);
    }
  }

  return ids;
}

/** Whether a post is addressed to this community. */
export function isPostFor(event: NostrEvent, address: string): boolean {
  return event.tags.some(([name, value]) => name === 'a' && value === address);
}
