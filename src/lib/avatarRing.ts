import { tierOf, tierRank, type NameTier } from '@/lib/tiers';

/**
 * Animated rings around an avatar, earned by tier.
 *
 * The point is that it cannot be claimed, only held. The choice is published
 * in the profile so other people see it, but the *entitlement* is not: it is
 * recomputed by every reader from the lightning address in that same profile,
 * using the same `tierOf` the rest of the app uses. Somebody who edits their
 * metadata to name a ring above their tier gets the plain one, on everybody
 * else's screen as well as their own — there is nothing to enforce server-side
 * because there is nothing to trust.
 *
 * Free accounts get a ring too. A decoration that only appears once money
 * changes hands teaches new arrivals that the feature is an advert; one that
 * starts subtle and gets better is a reason to look.
 */

export type RingId =
  | 'none'
  | 'pulse'
  | 'glow'
  | 'orbit'
  | 'aurora'
  | 'prism';

export interface RingStyle {
  id: RingId;
  label: string;
  /** One line, shown under the name in the picker. */
  blurb: string;
  /** The lowest tier that may wear it. Null means anyone, signed in or not. */
  requires: NameTier | null;
  /** Class applied to the ring element. Defined in `index.css`. */
  className: string;
}

/**
 * The catalogue, in the order it is offered.
 *
 * Deliberately short. A list of thirty makes the good ones hard to find and
 * turns the top tier into "the one with the most options" rather than "the one
 * that looks best".
 */
export const RING_STYLES: RingStyle[] = [
  {
    id: 'none',
    label: 'None',
    blurb: 'No ring at all.',
    requires: null,
    className: '',
  },
  {
    id: 'pulse',
    label: 'Pulse',
    blurb: 'A soft breath around the edge.',
    requires: null,
    className: 'avatar-ring-pulse',
  },
  {
    id: 'glow',
    label: 'Glow',
    blurb: 'A steady halo in your accent colour.',
    requires: 'assigned',
    className: 'avatar-ring-glow',
  },
  {
    id: 'orbit',
    label: 'Orbit',
    blurb: 'A light that travels around the circle.',
    requires: 'named',
    className: 'avatar-ring-orbit',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    blurb: 'Colour drifting slowly through the ring.',
    requires: 'named',
    className: 'avatar-ring-aurora',
  },
  {
    /*
     * Sat above `named` while there was a tier above it. There is not any
     * more, so it moved down rather than out — the ladder is still three
     * rungs (no address, free address, bought name) and deleting the best
     * ring would take something away from the people who had paid for it.
     */
    id: 'prism',
    label: 'Prism',
    blurb: 'A full spectrum, turning.',
    requires: 'named',
    className: 'avatar-ring-prism',
  },
];

const BY_ID = new Map(RING_STYLES.map((style) => [style.id, style]));

/** The kind 0 field the choice lives in. Documented in `NIP.md`. */
export const RING_FIELD = 'avatar_ring';

/**
 * Whether a tier may wear a ring.
 *
 * `null` requirement means anyone, including somebody with no lightning
 * address at all — a reader browsing with no account of their own still sees
 * other people's rings, and a new arrival is not shown an empty picker.
 */
export function canWear(style: RingStyle, tier: NameTier | null): boolean {
  if (style.requires === null) return true;
  if (tier === null) return false;

  return tierRank(tier) >= tierRank(style.requires);
}

/** Reads the chosen ring out of profile metadata. */
export function readRingChoice(
  metadata: Record<string, unknown> | undefined
): RingId {
  const raw = metadata?.[RING_FIELD];
  if (typeof raw !== 'string') return 'none';

  return BY_ID.has(raw as RingId) ? (raw as RingId) : 'none';
}

/**
 * The ring to actually draw, given a profile.
 *
 * Entitlement is checked here rather than at the point of writing, because the
 * write is not the only way the field gets set — another client could put
 * anything in it, and a profile edited before a subscription lapsed still
 * names the ring it used to be allowed. Falling back to nothing is the honest
 * answer in both cases.
 */
export function ringFor(
  metadata: Record<string, unknown> | undefined
): RingStyle | null {
  const style = BY_ID.get(readRingChoice(metadata));
  if (!style || style.id === 'none') return null;

  const lud16 = metadata?.lud16;
  const tier = typeof lud16 === 'string' ? tierOf(lud16) : null;

  return canWear(style, tier) ? style : null;
}

/** Everything a given tier may choose from, for the picker. */
export function availableRings(tier: NameTier | null): RingStyle[] {
  return RING_STYLES.filter((style) => canWear(style, tier));
}

/** Everything above what they hold, so the picker can say what is coming. */
export function lockedRings(tier: NameTier | null): RingStyle[] {
  return RING_STYLES.filter((style) => !canWear(style, tier));
}
