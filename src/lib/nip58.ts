import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-58: badges.
 *
 * Four kinds and one idea: an issuer defines a badge, awards it to people, and
 * each of those people decides for themselves whether it appears on their
 * profile. That last step is the whole design. Anybody can publish an award
 * naming anybody — awards are not requests and need no consent — so a client
 * that rendered awards directly would let a stranger put whatever they liked
 * on somebody else's profile.
 *
 * What is displayed comes from the owner's own kind 10008, and every entry in
 * it is checked before it renders:
 *
 *  - the award must reference the definition it is paired with, or an issuer's
 *    respectable badge could be paired with an unrelated award,
 *  - and the award must actually name the profile's owner, or anyone could
 *    display a badge issued to somebody else.
 *
 * Neither check is stated as a MUST in the NIP. Both are the difference
 * between a badge meaning something and meaning nothing.
 */

/** Addressable. The issuer's description of a badge. */
export const BADGE_DEFINITION_KIND = 30009;
/** The issuance itself: one definition, one or more recipients. */
export const BADGE_AWARD_KIND = 8;
/** Replaceable. What the owner chose to display, in order. */
export const PROFILE_BADGES_KIND = 10008;
/** Addressable NIP-51 set. Accepted badges, grouped and labelled. */
export const BADGE_SET_KIND = 30008;

/**
 * The `d` value of the superseded profile badges event.
 *
 * An earlier version of this NIP used kind 30008 with this identifier for the
 * profile list. Read as equivalent to a kind 10008, because people who set
 * their badges years ago should not find their profile suddenly bare.
 */
export const LEGACY_PROFILE_BADGES_D = 'profile_badges';

export interface BadgeImage {
  url: string;
  /** Pixels, when the tag carried a `width x height`. */
  width?: number;
  height?: number;
}

export interface BadgeDefinition {
  /** The `d` tag: unique per issuer. */
  identifier: string;
  /** `30009:<issuer>:<identifier>`. */
  address: string;
  issuer: string;
  name?: string;
  description?: string;
  image?: BadgeImage;
  /** Smaller versions, sorted small to large. */
  thumbs: BadgeImage[];
  event: NostrEvent;
}

export interface BadgeAward {
  /** The definition this award is for. */
  definitionAddress: string;
  /** Everyone named in this award. */
  recipients: string[];
  event: NostrEvent;
}

/** One `a`/`e` pair from a profile badges list, before anything is verified. */
export interface BadgeClaim {
  definitionAddress: string;
  awardId: string;
  /** Relay hint from the `e` tag, when one was given. */
  relay?: string;
}

/** A claim that survived checking, with everything it needs to render. */
export interface DisplayBadge {
  definition: BadgeDefinition;
  award: BadgeAward;
}

function parseDimensions(value: string | undefined): {
  width?: number;
  height?: number;
} {
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(value?.trim() ?? '');
  if (!match) return {};

  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
  };
}

function firstValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([key]) => key === name)?.[1]?.trim() || undefined;
}

export function definitionAddress(event: NostrEvent): string | null {
  const identifier = firstValue(event, 'd');
  if (!identifier) return null;

  return `${BADGE_DEFINITION_KIND}:${event.pubkey}:${identifier}`;
}

export function parseBadgeDefinition(
  event: NostrEvent
): BadgeDefinition | null {
  if (event.kind !== BADGE_DEFINITION_KIND) return null;

  const identifier = firstValue(event, 'd');
  if (!identifier) return null;

  const imageTag = event.tags.find(([name, url]) => name === 'image' && !!url);

  const thumbs = event.tags
    .filter(([name, url]) => name === 'thumb' && !!url?.trim())
    .map(([, url, dims]) => ({
      url: url.trim(),
      ...parseDimensions(dims),
    }))
    /**
     * Sorted small to large so picking one is a scan for the first that fits.
     * A thumb with no dimensions sorts last: it might be any size, and
     * guessing it is small would put a 1024px image in a 16px slot.
     */
    .sort((a, b) => (a.width ?? Infinity) - (b.width ?? Infinity));

  return {
    identifier,
    address: `${BADGE_DEFINITION_KIND}:${event.pubkey}:${identifier}`,
    issuer: event.pubkey,
    name: firstValue(event, 'name'),
    description: firstValue(event, 'description'),
    image: imageTag
      ? { url: imageTag[1].trim(), ...parseDimensions(imageTag[2]) }
      : undefined,
    thumbs,
    event,
  };
}

export function parseBadgeAward(event: NostrEvent): BadgeAward | null {
  if (event.kind !== BADGE_AWARD_KIND) return null;

  /**
   * "A single `a` tag" — an award naming two definitions is ambiguous about
   * which badge it grants, so it is not read rather than having one picked
   * for it.
   */
  const addresses = event.tags.filter(([name, value]) => name === 'a' && !!value);
  if (addresses.length !== 1) return null;

  const recipients = event.tags
    .filter(([name, pubkey]) => name === 'p' && /^[0-9a-f]{64}$/i.test(pubkey ?? ''))
    .map(([, pubkey]) => pubkey.toLowerCase());

  if (!recipients.length) return null;

  return {
    definitionAddress: addresses[0][1].trim(),
    recipients: [...new Set(recipients)],
    event,
  };
}

/**
 * The `a`/`e` pairs in a profile badges or badge set event.
 *
 * "Zero or more ordered consecutive pairs" — so an `a` is paired with the `e`
 * that immediately follows it, not with whichever `e` happens to be in the
 * list. "Clients SHOULD ignore `a` without corresponding `e` tag and
 * viceversa", which is what an unpaired tag gets here.
 *
 * Order is kept, because the order is the owner's choice about which badges
 * matter most.
 */
export function parseBadgeClaims(event: NostrEvent): BadgeClaim[] {
  const claims: BadgeClaim[] = [];
  const tags = event.tags;

  for (let index = 0; index < tags.length; index += 1) {
    const [name, value] = tags[index];
    if (name !== 'a' || !value?.trim()) continue;

    const next = tags[index + 1];
    if (next?.[0] !== 'e' || !next[1]?.trim()) continue;

    claims.push({
      definitionAddress: value.trim(),
      awardId: next[1].trim(),
      relay: next[2]?.trim() || undefined,
    });

    // The `e` belongs to this pair and cannot open another
    index += 1;
  }

  return claims;
}

/**
 * Whether the profile badges event is one this client should read.
 *
 * The current kind, or the superseded 30008 with the reserved `d`. A kind
 * 30008 with any other `d` is a badge set — a labelled group — and is a
 * different thing that must not be mistaken for the display list.
 */
export function isProfileBadges(event: NostrEvent): boolean {
  if (event.kind === PROFILE_BADGES_KIND) return true;

  return (
    event.kind === BADGE_SET_KIND &&
    firstValue(event, 'd') === LEGACY_PROFILE_BADGES_D
  );
}

/**
 * Keeps only the claims that hold up.
 *
 * The award has to be for the definition it was paired with, and it has to
 * name the person whose profile this is. Without the first, an issuer's
 * reputable badge can be shown alongside an award for something else entirely;
 * without the second, anybody can wear anybody's badge by pointing at their
 * award.
 */
export function verifyClaims(
  claims: BadgeClaim[],
  owner: string,
  definitions: Map<string, BadgeDefinition>,
  awards: Map<string, BadgeAward>
): DisplayBadge[] {
  const verified: DisplayBadge[] = [];
  const seen = new Set<string>();

  for (const claim of claims) {
    const definition = definitions.get(claim.definitionAddress);
    const award = awards.get(claim.awardId);

    if (!definition || !award) continue;

    // The award must be for this badge, not merely be an award
    if (award.definitionAddress !== claim.definitionAddress) continue;

    // ...and it must have been given to this person
    if (!award.recipients.includes(owner.toLowerCase())) continue;

    // One entry per badge, however many times it was listed
    if (seen.has(definition.address)) continue;
    seen.add(definition.address);

    verified.push({ definition, award });
  }

  return verified;
}

/**
 * The best image for the space available.
 *
 * "Clients SHOULD attempt to render the most appropriate badge thumbnail
 * according to the number of badges chosen by the user and space available."
 * The smallest thumb that still covers the target wins; below every thumb, the
 * smallest is used; above them all, the full image is.
 */
export function pickBadgeImage(
  definition: BadgeDefinition,
  targetPx: number
): string | undefined {
  const fitting = definition.thumbs.find(
    (thumb) => (thumb.width ?? 0) >= targetPx
  );

  return (
    fitting?.url ??
    definition.image?.url ??
    definition.thumbs[definition.thumbs.length - 1]?.url
  );
}

/** What to call a badge when the issuer left the name off. */
export function badgeName(definition: BadgeDefinition): string {
  return definition.name || definition.identifier;
}

export interface DefinitionInput {
  identifier: string;
  name?: string;
  description?: string;
  image?: BadgeImage;
  thumbs?: BadgeImage[];
}

function imageTag(name: string, image: BadgeImage): string[] {
  return image.width && image.height
    ? [name, image.url, `${image.width}x${image.height}`]
    : [name, image.url];
}

export function buildDefinitionTags(input: DefinitionInput): string[][] {
  const tags: string[][] = [['d', input.identifier]];

  if (input.name?.trim()) tags.push(['name', input.name.trim()]);
  if (input.description?.trim()) {
    tags.push(['description', input.description.trim()]);
  }
  if (input.image?.url) tags.push(imageTag('image', input.image));

  for (const thumb of input.thumbs ?? []) {
    if (thumb.url) tags.push(imageTag('thumb', thumb));
  }

  return tags;
}

/** The tags of a kind 8: one definition, and everyone being given it. */
export function buildAwardTags(
  address: string,
  recipients: { pubkey: string; relay?: string }[]
): string[][] {
  return [
    ['a', address],
    ...recipients.map((recipient) =>
      recipient.relay
        ? ['p', recipient.pubkey, recipient.relay]
        : ['p', recipient.pubkey]
    ),
  ];
}

/**
 * The tags of a profile badges list.
 *
 * Emitted as consecutive `a`/`e` pairs in the given order, which is the format
 * and also the owner's ranking.
 */
export function buildProfileBadgeTags(badges: DisplayBadge[]): string[][] {
  return badges.flatMap((badge) => [
    ['a', badge.definition.address],
    ['e', badge.award.event.id],
  ]);
}
