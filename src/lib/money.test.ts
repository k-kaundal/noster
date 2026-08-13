import { describe, it, expect } from 'vitest';
import {
  MSAT_PER_SAT,
  formatSatsFull,
  isMsat,
  isWholeSats,
  splitPercent,
  sumMsat,
  toMsat,
  toSats,
} from './money';

describe('toMsat and toSats', () => {
  it('converts between the unit people read and the unit Lightning settles in', () => {
    expect(toMsat(10_000)).toBe(10_000_000);
    expect(toSats(10_000_000)).toBe(10_000);
    expect(MSAT_PER_SAT).toBe(1000);
  });

  it('rounds down to whole sats, never up', () => {
    // Up would show a balance that cannot be spent and an invoice that
    // cannot be paid
    expect(toSats(1_999)).toBe(1);
    expect(toSats(999)).toBe(0);
  });

  it('refuses a fractional sat instead of quietly rounding it', () => {
    // A caller passing 0.5 sats has a bug, and this is the last point it can
    // still be caught
    expect(() => toMsat(0.5)).toThrow(RangeError);
    expect(() => toMsat(Number.NaN)).toThrow(RangeError);
  });
});

describe('isMsat', () => {
  it('accepts whole, non-negative, exactly representable amounts', () => {
    expect(isMsat(0)).toBe(true);
    expect(isMsat(21_000_000)).toBe(true);
  });

  it('rejects anything that cannot be money', () => {
    expect(isMsat(-1)).toBe(false);
    expect(isMsat(1.5)).toBe(false);
    expect(isMsat(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
    expect(isMsat('1000')).toBe(false);
  });
});

describe('isWholeSats', () => {
  it('spots a millisat remainder', () => {
    expect(isWholeSats(1_000)).toBe(true);
    expect(isWholeSats(1_001)).toBe(false);
  });
});

describe('splitPercent', () => {
  it('splits a fee off an amount', () => {
    expect(splitPercent(toMsat(10_000), 10)).toEqual({
      taken: toMsat(1_000),
      remainder: toMsat(9_000),
    });
  });

  it('always adds back up to what went in', () => {
    /**
     * The property that matters. A fee taken as `amount * 0.1` in floating
     * point loses or invents millisats, always in the direction of whoever
     * wrote the code — which is the worst possible direction.
     */
    for (const total of [1, 7, 999, 1_000_001, 123_456_789]) {
      const { taken, remainder } = splitPercent(total, 10);
      expect(taken + remainder).toBe(total);
    }
  });

  it('gives the leftover millisat to the creator, not the platform', () => {
    const { taken, remainder } = splitPercent(7, 10);

    expect(taken).toBe(0);
    expect(remainder).toBe(7);
  });

  it('handles the ends of the range', () => {
    expect(splitPercent(1000, 0)).toEqual({ taken: 0, remainder: 1000 });
    expect(splitPercent(1000, 100)).toEqual({ taken: 1000, remainder: 0 });
  });

  it('refuses a nonsensical percentage or amount', () => {
    expect(() => splitPercent(1000, 101)).toThrow(RangeError);
    expect(() => splitPercent(1000, -1)).toThrow(RangeError);
    expect(() => splitPercent(1.5, 10)).toThrow(RangeError);
  });
});

describe('sumMsat', () => {
  it('adds amounts', () => {
    expect(sumMsat([1_000, 2_000, 3_000])).toBe(6_000);
    expect(sumMsat([])).toBe(0);
  });

  it('throws rather than returning a total it cannot represent', () => {
    // A ledger is the last place an approximate answer belongs
    expect(() => sumMsat([Number.MAX_SAFE_INTEGER, 10])).toThrow(RangeError);
  });
});

describe('formatSatsFull', () => {
  it('writes a price to the digit', () => {
    // Distinct from the compact form on a post: a price is read exactly,
    // a zap total is read at a glance
    expect(formatSatsFull(toMsat(10_000))).toBe('10,000 sats');
    expect(formatSatsFull(toMsat(1))).toBe('1 sats');
  });
});
