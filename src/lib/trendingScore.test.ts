import { describe, it, expect } from 'vitest';
import { calculateEngagementScore } from './trendingScore';

describe('calculateEngagementScore', () => {
  it('scores nothing for no engagement', () => {
    expect(calculateEngagementScore()).toBe(0);
    expect(calculateEngagementScore({ ageHours: 5 })).toBe(0);
  });

  it('counts a zap for more than a like', () => {
    // A like is free and reversible; a zap costs money and is not
    const zapped = calculateEngagementScore({ zaps: 1, zapSats: 0 });
    const liked = calculateEngagementScore({ likes: 1 });

    expect(zapped).toBeGreaterThan(liked);
  });

  it('ranks a paid post above a tapped one', () => {
    const paid = calculateEngagementScore({ zaps: 5, zapSats: 1000 });
    const tapped = calculateEngagementScore({ likes: 20 });

    expect(paid).toBeGreaterThan(tapped);
  });

  it('lets many small zaps beat one large one', () => {
    /*
     * The reason the amount is rooted. Linearly, one person sending 100,000
     * sats outranks everything else on the site, and trending becomes a list
     * of whatever the richest account felt like promoting — for the price of
     * one zap to itself.
     */
    const whale = calculateEngagementScore({ zaps: 1, zapSats: 100_000 });
    const crowd = calculateEngagementScore({ zaps: 100, zapSats: 100_000 });

    expect(crowd).toBeGreaterThan(whale * 2);
  });

  it('does not let one huge zap outrank a genuinely popular post', () => {
    const selfZap = calculateEngagementScore({ zaps: 1, zapSats: 1_000_000 });
    const popular = calculateEngagementScore({
      likes: 300,
      reposts: 80,
      zaps: 40,
      zapSats: 40_000,
    });

    expect(popular).toBeGreaterThan(selfZap);
  });

  it('still counts likes, replies and reposts', () => {
    // Age zeroed, so these are the raw weights rather than the decayed ones
    expect(calculateEngagementScore({ likes: 10, ageHours: 0 })).toBe(10);
    expect(calculateEngagementScore({ replies: 10, ageHours: 0 })).toBe(20);
    expect(calculateEngagementScore({ reposts: 10, ageHours: 0 })).toBe(30);
  });

  it('decays with age', () => {
    const fresh = calculateEngagementScore({ zaps: 5, ageHours: 1 });
    const old = calculateEngagementScore({ zaps: 5, ageHours: 100 });

    expect(fresh).toBeGreaterThan(old);
  });

  it('never decays away entirely', () => {
    // A floor, so something ancient and enormous can still place
    const ancient = calculateEngagementScore({ zaps: 100, ageHours: 100_000 });
    expect(ancient).toBeGreaterThan(0);
  });

  it('ignores a negative or nonsensical amount', () => {
    expect(calculateEngagementScore({ zapSats: -500 })).toBe(0);
  });
});
