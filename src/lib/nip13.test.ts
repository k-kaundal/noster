import { describe, it, expect } from 'vitest';
import {
  checkPow,
  committedDifficulty,
  countLeadingZeroes,
  eventDifficulty,
  mineEvent,
} from './nip13';

/** The spec's reference C, ported, to check ours against. */
function referenceCount(hex: string): number {
  const zeroBits = (byte: number): number => {
    let n = 0;
    if (byte === 0) return 8;
    while ((byte >>= 1)) n += 1;
    return 7 - n;
  };

  let total = 0;

  for (let i = 0; i < 32; i += 1) {
    const bits = zeroBits(Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
    total += bits;
    if (bits !== 8) break;
  }

  return total;
}

describe('countLeadingZeroes', () => {
  it('matches the two examples the spec gives', () => {
    expect(
      countLeadingZeroes(
        '000000000e9d97a1ab09fc381030b346cdd7a142ad57e6df0b46dc9bef6c7e2d'
      )
    ).toBe(36);

    // "002f... is 0000 0000 0010 1111..., which has 10 leading zeroes"
    expect(countLeadingZeroes('002f' + '0'.repeat(60))).toBe(10);
  });

  it('counts bits, not hex digits, for every digit', () => {
    const expected: Record<string, number> = {
      '1': 3, '2': 2, '3': 2, '4': 1, '5': 1, '6': 1, '7': 1,
      '8': 0, '9': 0, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0,
    };

    for (const [digit, bits] of Object.entries(expected)) {
      expect(countLeadingZeroes(digit + '0'.repeat(63))).toBe(bits);
    }
  });

  it('agrees with the reference implementation', () => {
    for (let trial = 0; trial < 5000; trial += 1) {
      const bytes = Array.from({ length: 32 }, (_, index) =>
        // Weighted toward leading zeroes so the interesting range is covered
        index < 3 && Math.random() < 0.6 ? 0 : Math.floor(Math.random() * 256)
      );

      const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(countLeadingZeroes(hex)).toBe(referenceCount(hex));
    }
  });
});

describe('committedDifficulty', () => {
  it('reads the third entry of the nonce tag', () => {
    expect(committedDifficulty({ tags: [['nonce', '776797', '20']] })).toBe(20);
  });

  it('separates no commitment from a commitment to zero', () => {
    expect(committedDifficulty({ tags: [] })).toBeNull();
    expect(committedDifficulty({ tags: [['nonce', '1']] })).toBeNull();
    expect(committedDifficulty({ tags: [['nonce', '1', 'abc']] })).toBeNull();
    expect(committedDifficulty({ tags: [['nonce', '1', '0']] })).toBe(0);
  });
});

describe('checkPow', () => {
  /** 40 leading zero bits. */
  const id = '0'.repeat(10) + 'f'.repeat(54);

  it('reads the spec example note', () => {
    expect(
      eventDifficulty({
        id: '000006d8c378af1779d2feebc7603a125d99eca0ccf1085959b307f64e5dd358',
      })
    ).toBeGreaterThanOrEqual(20);
  });

  it('rejects a lucky note that committed to less', () => {
    /**
     * The spec's own scenario: "if you require 40 bits to reply to your thread
     * and see a committed target of 30, you can safely reject it even if the
     * note has 40 bits difficulty".
     */
    const lucky = { id, tags: [['nonce', '1', '30']] };

    expect(eventDifficulty(lucky)).toBe(40);
    expect(checkPow(lucky, 40)).toMatchObject({
      ok: false,
      reason: 'target-too-low',
    });

    // The same note is fine against the difficulty it actually aimed at
    expect(checkPow(lucky, 30).ok).toBe(true);
  });

  it('accepts an honest note that committed to enough', () => {
    expect(checkPow({ id, tags: [['nonce', '1', '40']] }, 40).ok).toBe(true);
  });

  it('rejects an id without enough zeroes whatever it claims', () => {
    expect(
      checkPow({ id: 'f'.repeat(64), tags: [['nonce', '1', '40']] }, 40)
    ).toMatchObject({ ok: false, reason: 'too-low' });
  });

  it('only rejects a missing commitment when asked to', () => {
    expect(checkPow({ id, tags: [] }, 40).ok).toBe(true);
    expect(
      checkPow({ id, tags: [] }, 40, { requireCommitment: true })
    ).toMatchObject({ ok: false, reason: 'no-commitment' });
  });

  it('passes everything when nothing is required', () => {
    expect(checkPow({ id: 'f'.repeat(64), tags: [] }, 0).ok).toBe(true);
  });
});

describe('mineEvent', () => {
  const draft = {
    kind: 1,
    content: "It's just me mining my own business",
    tags: [['t', 'test']],
    created_at: 1651794653,
    pubkey: 'a48380f4cfcc1ad5378294fcac36439770f9c878dd880ffa94bb74ea54a6f243',
  };

  it('reaches the target and commits to it', async () => {
    const result = await mineEvent(draft, 10);

    expect(result.difficulty).toBeGreaterThanOrEqual(10);
    expect(countLeadingZeroes(result.id)).toBe(result.difficulty);

    const nonce = result.event.tags.find(([name]) => name === 'nonce');
    expect(nonce?.[2]).toBe('10');
    expect(checkPow({ id: result.id, tags: result.event.tags }, 10).ok).toBe(true);
  });

  it('keeps the event\'s own tags', async () => {
    const result = await mineEvent(draft, 8);
    expect(result.event.tags).toContainEqual(['t', 'test']);
  });

  it('replaces the nonce rather than stacking them', async () => {
    const once = await mineEvent(draft, 8);
    const twice = await mineEvent(once.event, 8);

    expect(
      twice.event.tags.filter(([name]) => name === 'nonce')
    ).toHaveLength(1);
  });

  it('does nothing for a target of zero', async () => {
    const result = await mineEvent(draft, 0);

    expect(result.attempts).toBe(0);
    expect(result.event.tags.some(([name]) => name === 'nonce')).toBe(false);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    await expect(
      mineEvent(draft, 32, { signal: controller.signal })
    ).rejects.toThrow(/cancel/i);
  });
});
