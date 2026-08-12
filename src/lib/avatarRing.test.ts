import { describe, it, expect } from 'vitest';
import {
  RING_FIELD,
  RING_STYLES,
  availableRings,
  canWear,
  lockedRings,
  readRingChoice,
  ringFor,
} from './avatarRing';
import { ADDRESS_DOMAIN } from './lightningAddress';

/** An address of each tier, built from the domains `tierOf` actually reads. */
/** `u` + 12 hex characters is the shape `isGeneratedName` recognises. */
const FREE = `u0123456789ab@${ADDRESS_DOMAIN}`;
const NAMED = `alice@${ADDRESS_DOMAIN}`;
const FOREIGN = 'alice@getalby.com';

describe('canWear', () => {
  const style = (id: string) => RING_STYLES.find((entry) => entry.id === id)!;

  it('lets anybody wear the unrestricted ones, even with no address', () => {
    expect(canWear(style('none'), null)).toBe(true);
    expect(canWear(style('pulse'), null)).toBe(true);
  });

  it('gates the paid ones', () => {
    expect(canWear(style('orbit'), 'assigned')).toBe(false);
    expect(canWear(style('orbit'), 'named')).toBe(true);
  });

  it('reserves the best rings for the bought tier', () => {
    expect(canWear(style('prism'), 'assigned')).toBe(false);
    expect(canWear(style('prism'), 'named')).toBe(true);
  });
});

describe('readRingChoice', () => {
  it('reads a known id', () => {
    expect(readRingChoice({ [RING_FIELD]: 'orbit' })).toBe('orbit');
  });

  it('falls back for anything else', () => {
    expect(readRingChoice(undefined)).toBe('none');
    expect(readRingChoice({})).toBe('none');
    expect(readRingChoice({ [RING_FIELD]: 'sparkles' })).toBe('none');
    expect(readRingChoice({ [RING_FIELD]: 42 })).toBe('none');
  });
});

describe('ringFor', () => {
  it('draws a ring the profile has earned', () => {
    expect(ringFor({ lud16: NAMED, [RING_FIELD]: 'orbit' })?.id).toBe('orbit');
    expect(ringFor({ lud16: NAMED, [RING_FIELD]: 'prism' })?.id).toBe('prism');
  });

  it('refuses one it has not', () => {
    /**
     * The whole security model: entitlement is recomputed by every reader from
     * the lightning address in the same profile, so writing a ring you cannot
     * hold gets you nothing on anybody's screen, including your own.
     */
    expect(ringFor({ lud16: FREE, [RING_FIELD]: 'prism' })).toBeNull();
    expect(ringFor({ lud16: FREE, [RING_FIELD]: 'orbit' })).toBeNull();
    expect(ringFor({ lud16: FOREIGN, [RING_FIELD]: 'prism' })).toBeNull();
  });

  it('still allows the unrestricted ones without any address', () => {
    expect(ringFor({ [RING_FIELD]: 'pulse' })?.id).toBe('pulse');
    expect(ringFor({ lud16: FOREIGN, [RING_FIELD]: 'pulse' })?.id).toBe('pulse');
  });

  it('gives an address from another provider no tier at all', () => {
    // Real address, not one of ours — so the gated rings stay locked
    expect(ringFor({ lud16: FOREIGN, [RING_FIELD]: 'orbit' })).toBeNull();
  });

  it('draws nothing for none, or for junk', () => {
    expect(ringFor({ lud16: NAMED, [RING_FIELD]: 'none' })).toBeNull();
    expect(ringFor({ lud16: NAMED, [RING_FIELD]: 'nonsense' })).toBeNull();
    expect(ringFor(undefined)).toBeNull();
  });

  it('is not fooled by a non-string lud16', () => {
    expect(
      ringFor({ lud16: { toString: () => NAMED }, [RING_FIELD]: 'orbit' })
    ).toBeNull();
  });
});

describe('availableRings and lockedRings', () => {
  it('partition the catalogue with nothing lost or duplicated', () => {
    for (const tier of [null, 'assigned', 'named'] as const) {
      const open = availableRings(tier);
      const shut = lockedRings(tier);

      expect(open.length + shut.length).toBe(RING_STYLES.length);
      expect(open.some((style) => shut.includes(style))).toBe(false);
    }
  });

  it('opens more as the tier rises', () => {
    const counts = [null, 'assigned', 'named'].map(
      (tier) => availableRings(tier as 'assigned' | 'named' | null).length
    );

    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
  });

  it('leaves the top tier nothing locked', () => {
    expect(lockedRings('named')).toEqual([]);
  });
});
