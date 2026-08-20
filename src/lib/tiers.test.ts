import { describe, it, expect } from 'vitest';
import {
  describeTier,
  leadAddress,
  nextTier,
  rankAddresses,
  tierOf,
  tierRank,
} from './tiers';

const DOMAINS = { named: 'ln.nostrfeed.com' };

/** The assigned name for a key, as `freeAddress` derives it. */
const ASSIGNED = 'uf1ee81bb8437';

describe('tierOf', () => {
  it('separates a bought name from an assigned one at our own domain', () => {
    expect(tierOf('kk@ln.nostrfeed.com', DOMAINS)).toBe('named');
    expect(tierOf(`${ASSIGNED}@ln.nostrfeed.com`, DOMAINS)).toBe('assigned');
  });

  it('claims nothing about an address from somewhere else', () => {
    // Real, and not one of our tiers. Calling it free would badge somebody's
    // own wallet as something we gave them
    expect(tierOf('me@getalby.com', DOMAINS)).toBeNull();
    // The wallet service that used to issue the third tier is gone, so its
    // domain is now just somebody else's
    expect(tierOf('kk@getzap.me', DOMAINS)).toBeNull();
  });

  it('ignores case and rejects anything that is not an address', () => {
    expect(tierOf('KK@LN.NostrFeed.com', DOMAINS)).toBe('named');
    expect(tierOf('notanaddress', DOMAINS)).toBeNull();
    expect(tierOf('@ln.nostrfeed.com', DOMAINS)).toBeNull();
  });

  it('never offers the middle rung as an upgrade', () => {
    // "Not verified" is a state a name is in, not something to buy — an
    // upsell pointing at it would advertise what somebody already has
    expect(nextTier('assigned')).toBe('named');
    expect(nextTier('unverified')).toBe('named');
  });

  it('takes the held names over the shape of the address', () => {
    /**
     * The correction. A chosen-looking local part is not evidence of anything:
     * attaching a lightning address to `dev@getzap.me` makes the extension
     * issue a pay link named `dev`, and LNbits answers for it on its own host
     * — so `dev@ln.nostrfeed.com` appeared, wearing a ✓ nobody bought and no
     * client would honour, while the name really held sat on another domain.
     */
    const both = { named: ['ln.nostrfeed.com', 'getzap.me'] };
    const held = ['dev@getzap.me'];

    expect(tierOf('dev@getzap.me', both, held)).toBe('named');
    expect(tierOf('dev@ln.nostrfeed.com', both, held)).toBe('unverified');
  });

  it('compares a held name however it is spelled', () => {
    expect(
      tierOf('dev@getzap.me', { named: 'getzap.me' }, [' DEV@GetZap.me '])
    ).toBe('named');
  });

  it('still refuses an outside domain even when a name matches', () => {
    // Holding `dev` somewhere of ours says nothing about `dev` at a service
    // we do not run
    expect(
      tierOf('dev@getalby.com', DOMAINS, ['dev@getalby.com'])
    ).toBeNull();
  });

  it('reads the shape when there is nothing to check against', () => {
    // Ranking a stranger's `lud16` has only the string, and an empty list is
    // not the same as no list — one says "holds nothing", the other "unknown"
    expect(tierOf('kk@ln.nostrfeed.com', DOMAINS)).toBe('named');
    expect(tierOf('kk@ln.nostrfeed.com', DOMAINS, [])).toBe('unverified');
  });
});

describe('rankAddresses', () => {
  it('puts what somebody paid for above what they were given', () => {
    // The order is the point: a person who bought their way up should not
    // hunt for it underneath the free one they arrived with
    const ranked = rankAddresses(
      [`${ASSIGNED}@ln.nostrfeed.com`, 'kk@ln.nostrfeed.com'],
      DOMAINS
    );

    expect(ranked.map((entry) => entry.tier)).toEqual(['named', 'assigned']);
  });

  it('drops addresses that are not ours', () => {
    expect(rankAddresses(['me@getalby.com'], DOMAINS)).toEqual([]);
  });

  it('counts a repeated address once', () => {
    expect(
      rankAddresses(['kk@ln.nostrfeed.com', 'KK@ln.nostrfeed.com'], DOMAINS)
    ).toHaveLength(1);
  });

  it('handles holding nothing', () => {
    expect(rankAddresses([], DOMAINS)).toEqual([]);
  });

  it('separates a name waiting to be bought from the assigned one', () => {
    /*
     * Both are unverified and only one is free. `dev@…` is a name somebody
     * picked, on sale at the domain it already sits at; the other was derived
     * from the key and is not for sale at all.
     */
    const ranked = rankAddresses(
      [`${ASSIGNED}@ln.nostrfeed.com`, 'dev@ln.nostrfeed.com'],
      DOMAINS,
      []
    );

    expect(ranked.map((entry) => [entry.address, entry.tier])).toEqual([
      ['dev@ln.nostrfeed.com', 'unverified'],
      [`${ASSIGNED}@ln.nostrfeed.com`, 'assigned'],
    ]);
  });

  it('carries the domain, so a row can say where to buy the ✓', () => {
    expect(
      rankAddresses(['dev@LN.NostrFeed.com'], DOMAINS, [])[0].domain
    ).toBe('ln.nostrfeed.com');
  });
});

describe('leadAddress', () => {
  const held = [`${ASSIGNED}@ln.nostrfeed.com`, 'kk@ln.nostrfeed.com'];

  it('leads with the best tier by default', () => {
    expect(leadAddress(held, null, DOMAINS)?.address).toBe('kk@ln.nostrfeed.com');
  });

  it('honours a deliberate choice over the ranking', () => {
    // Someone who points zaps at their free address on purpose keeps that
    // decision across visits rather than being quietly overruled
    expect(leadAddress(held, `${ASSIGNED}@ln.nostrfeed.com`, DOMAINS)?.tier).toBe(
      'assigned'
    );
  });

  it('falls back to the ranking when the choice is no longer held', () => {
    expect(leadAddress(held, 'gone@ln.nostrfeed.com', DOMAINS)?.address).toBe(
      'kk@ln.nostrfeed.com'
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
  });

  it('offers nothing above the top', () => {
    // An upsell shown to somebody already on the top tier reads as the app
    // not knowing what they bought
    expect(nextTier('named')).toBeNull();
  });
});

describe('describeTier', () => {
  it('gives every tier a mark and words', () => {
    for (const tier of ['assigned', 'named'] as const) {
      const copy = describeTier(tier);
      expect(copy.label).toBeTruthy();
      expect(copy.blurb).toBeTruthy();
      expect(copy.mark).toBeTruthy();
    }
  });

  it('does not call a name somebody picked free or assigned', () => {
    // It is neither: the domain sells that name, and buying it is what adds
    // the ✓ — so the line has to point at the purchase, not at a verdict
    const copy = describeTier('unverified', { domain: 'ln.nostrfeed.com' });

    expect(copy.label).not.toMatch(/free/i);
    expect(copy.blurb).not.toMatch(/assigned/i);
    expect(copy.blurb).toContain('ln.nostrfeed.com');
  });

  it('still says where to buy without a domain to name', () => {
    expect(describeTier('unverified').blurb).toBeTruthy();
  });

  it('ranks in the order it describes', () => {
    expect(tierRank('assigned')).toBeLessThan(tierRank('named'));
  });
});
