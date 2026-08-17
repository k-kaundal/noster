import { describe, it, expect } from 'vitest';
import {
  EMPTY_WATERMARK,
  MAX_ANNOUNCE_AGE_MS,
  advanced,
  isRecentEnough,
  newsFrom,
  watermarkFor,
} from './notifyWatermark';

const NOW = 1_700_000_000_000;
/** `created_at` is in seconds; notifications carry it unchanged. */
const nowSeconds = NOW / 1000;

function item(createdAt: number) {
  return { createdAt };
}

describe('watermarkFor', () => {
  it('accepts a mark belonging to this account', () => {
    const stored = { pubkey: 'alice', through: 500 };
    expect(watermarkFor(stored, 'alice')).toBe(stored);
  });

  it('refuses another account mark, so a new account is not silenced', () => {
    expect(watermarkFor({ pubkey: 'bob', through: 9e9 }, 'alice')).toBeNull();
  });

  it('refuses a missing mark', () => {
    expect(watermarkFor(undefined, 'alice')).toBeNull();
  });

  it('refuses a mark with no account signed in', () => {
    expect(watermarkFor({ pubkey: '', through: 5 }, '')).toBeNull();
  });

  it('refuses a corrupt timestamp rather than trusting it', () => {
    // A NaN mark compares false against everything, which would announce the
    // entire backlog
    const corrupt = { pubkey: 'alice', through: Number.NaN };
    expect(watermarkFor(corrupt, 'alice')).toBeNull();
  });
});

describe('isRecentEnough', () => {
  it('accepts something that just happened', () => {
    expect(isRecentEnough(nowSeconds - 60, NOW)).toBe(true);
  });

  it('refuses something from before the window', () => {
    const old = nowSeconds - MAX_ANNOUNCE_AGE_MS / 1000 - 60;
    expect(isRecentEnough(old, NOW)).toBe(false);
  });

  it('accepts something exactly at the edge', () => {
    expect(isRecentEnough(nowSeconds - MAX_ANNOUNCE_AGE_MS / 1000, NOW)).toBe(true);
  });
});

describe('newsFrom', () => {
  const mark = { pubkey: 'alice', through: nowSeconds - 3600 };

  it('takes what arrived after the mark', () => {
    const fresh = item(nowSeconds - 60);
    expect(newsFrom([fresh, item(nowSeconds - 7200)], mark, NOW)).toEqual([fresh]);
  });

  it('ignores anything at the mark exactly', () => {
    expect(newsFrom([item(mark.through)], mark, NOW)).toEqual([]);
  });

  it('refuses to announce something old that slipped above the mark', () => {
    /*
     * This is the bug the age floor exists for. A watermark seeded from one
     * fast relay's partial answer sits below events that were announced in an
     * earlier session; when the slower relays catch up, those events are above
     * the mark and would be announced a second time hours later.
     */
    const stale = { pubkey: 'alice', through: nowSeconds - 30 * 86400 };
    const yesterday = item(nowSeconds - 86400);

    expect(yesterday.createdAt).toBeGreaterThan(stale.through);
    expect(newsFrom([yesterday], stale, NOW)).toEqual([]);
  });

  it('lets a recent item through even from a very old mark', () => {
    const stale = { pubkey: 'alice', through: 1 };
    const recent = item(nowSeconds - 60);

    expect(newsFrom([recent], stale, NOW)).toEqual([recent]);
  });

  it('refuses an item timestamped in the future beyond the window', () => {
    // Relays serve what they are given, and clocks are not to be trusted
    expect(newsFrom([item(nowSeconds - 86400)], EMPTY_WATERMARK, NOW)).toEqual([]);
  });

  it('finds nothing in an empty list', () => {
    expect(newsFrom([], mark, NOW)).toEqual([]);
  });
});

describe('advanced', () => {
  it('moves up to the newest item seen', () => {
    const next = advanced(
      { pubkey: 'alice', through: 100 },
      [item(300), item(200)],
      'alice'
    );

    expect(next).toEqual({ pubkey: 'alice', through: 300 });
  });

  it('never moves backwards when a refetch returns less', () => {
    /*
     * The normal case, not an edge one: relays answer with different subsets
     * every minute. A mark that followed the answer down would re-announce the
     * difference on the way back up.
     */
    const next = advanced({ pubkey: 'alice', through: 900 }, [item(100)], 'alice');
    expect(next.through).toBe(900);
  });

  it('starts from nothing when the mark belongs to another account', () => {
    const next = advanced({ pubkey: 'bob', through: 9e9 }, [item(300)], 'alice');
    expect(next).toEqual({ pubkey: 'alice', through: 300 });
  });

  it('keeps the mark where it is when nothing is visible', () => {
    const next = advanced({ pubkey: 'alice', through: 500 }, [], 'alice');
    expect(next).toEqual({ pubkey: 'alice', through: 500 });
  });

  it('claims the account on a first seeding', () => {
    const next = advanced(EMPTY_WATERMARK, [item(700)], 'alice');
    expect(next).toEqual({ pubkey: 'alice', through: 700 });
  });
});

describe('the seed-then-announce cycle', () => {
  it('announces nothing on a first look, then only what follows', () => {
    // Reproduces the reported fault end to end: launch, partial answer, a
    // fuller answer a minute later, and no re-announcement of the backlog
    const backlog = [item(nowSeconds - 3600), item(nowSeconds - 5400)];

    const seeded = advanced(EMPTY_WATERMARK, backlog, 'alice');
    expect(newsFrom(backlog, seeded, NOW)).toEqual([]);

    // The slower relays catch up with older items the first answer missed
    const fuller = [...backlog, item(nowSeconds - 4000), item(nowSeconds - 7000)];
    expect(newsFrom(fuller, seeded, NOW)).toEqual([]);

    // Something genuinely new does get through
    const arrival = item(nowSeconds - 10);
    expect(newsFrom([arrival, ...fuller], seeded, NOW)).toEqual([arrival]);
  });
});
