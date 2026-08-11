import { describe, it, expect } from 'vitest';
import {
  describeTier,
  leadAddress,
  nextTier,
  rankAddresses,
  tierOf,
  tierRank,
} from './tiers';

const DOMAINS = { named: 'ln.nostrfeed.com', portable: 'getzap.me' };

/** The assigned name for a key, as `freeAddress` derives it. */
const ASSIGNED = 'uf1ee81bb8437';

describe('tierOf', () => {
  it('reads a portable address from its domain', () => {
    expect(tierOf('kk@getzap.me', DOMAINS)).toBe('portable');
    // Whatever it is called — the domain is what cannot be faked by a name
    expect(tierOf(`${ASSIGNED}@getzap.me`, DOMAINS)).toBe('portable');
  });

  it('separates a bought name from an assigned one at our own domain', () => {
    expect(tierOf('kk@ln.nostrfeed.com', DOMAINS)).toBe('named');
    expect(tierOf(`${ASSIGNED}@ln.nostrfeed.com`, DOMAINS)).toBe('assigned');
  });

  it('claims nothing about an address from somewhere else', () => {
    // Real, and not one of our tiers. Calling it free would badge somebody's
    // own wallet as something we gave them
    expect(tierOf('me@getalby.com', DOMAINS)).toBeNull();
  });

  it('ignores case and rejects anything that is not an address', () => {
    expect(tierOf('KK@GetZap.me', DOMAINS)).toBe('portable');
    expect(tierOf('notanaddress', DOMAINS)).toBeNull();
    expect(tierOf('@getzap.me', DOMAINS)).toBeNull();
  });
});

describe('rankAddresses', () => {
  it('puts what somebody paid for above what they were given', () => {
    // The order is the point: a person who bought their way up should not
    // hunt for it underneath the free one they arrived with
    const ranked = rankAddresses(
      [
        `${ASSIGNED}@ln.nostrfeed.com`,
        'kk@getzap.me',
        'kk@ln.nostrfeed.com',
      ],
      DOMAINS
    );

    expect(ranked.map((entry) => entry.tier)).toEqual([
      'portable',
      'named',
      'assigned',
    ]);
  });

  it('drops addresses that are not ours', () => {
    expect(rankAddresses(['me@getalby.com'], DOMAINS)).toEqual([]);
  });

  it('counts a repeated address once', () => {
    expect(
      rankAddresses(['kk@getzap.me', 'KK@getzap.me'], DOMAINS)
    ).toHaveLength(1);
  });

  it('handles holding nothing', () => {
    expect(rankAddresses([], DOMAINS)).toEqual([]);
  });
});

describe('leadAddress', () => {
  const held = [
    `${ASSIGNED}@ln.nostrfeed.com`,
    'kk@ln.nostrfeed.com',
    'kk@getzap.me',
  ];

  it('leads with the best tier by default', () => {
    expect(leadAddress(held, null, DOMAINS)?.address).toBe('kk@getzap.me');
  });

  it('honours a deliberate choice over the ranking', () => {
    // Someone who points zaps at their free address on purpose keeps that
    // decision across visits rather than being quietly overruled
    expect(leadAddress(held, `${ASSIGNED}@ln.nostrfeed.com`, DOMAINS)?.tier).toBe(
      'assigned'
    );
  });

  it('falls back to the ranking when the choice is no longer held', () => {
    expect(leadAddress(held, 'gone@getzap.me', DOMAINS)?.address).toBe(
      'kk@getzap.me'
    );
  });

  it('is null when there is nothing of ours to lead with', () => {
    expect(leadAddress([], null, DOMAINS)).toBeNull();
    expect(leadAddress(['me@getalby.com'], null, DOMAINS)).toBeNull();
  });
});

describe('nextTier', () => {
  it('names what there is left to buy', () => {
    expect(nextTier(null)).toBe('assigned');
    expect(nextTier('assigned')).toBe('named');
    expect(nextTier('named')).toBe('portable');
  });

  it('offers nothing above the top', () => {
    // An upsell shown to somebody already on the top tier reads as the app
    // not knowing what they bought
    expect(nextTier('portable')).toBeNull();
  });
});

describe('describeTier', () => {
  it('gives every tier a mark and words', () => {
    for (const tier of ['assigned', 'named', 'portable'] as const) {
      const copy = describeTier(tier);
      expect(copy.label).toBeTruthy();
      expect(copy.blurb).toBeTruthy();
      expect(copy.mark).toBeTruthy();
    }
  });

  it('ranks in the order it describes', () => {
    expect(tierRank('assigned')).toBeLessThan(tierRank('named'));
    expect(tierRank('named')).toBeLessThan(tierRank('portable'));
  });
});
