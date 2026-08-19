import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  EMPTY_SUMMARY,
  dailyEarnings,
  describeSource,
  earningFrom,
  summarizeStudio,
  type Earning,
} from './studio';

const NOW = 1_700_000_000_000;
const seconds = Math.floor(NOW / 1000);
const DAY = 86400;

/** A receipt whose amount is stated in the request, as most real ones are. */
function receipt(
  requestTags: string[][],
  over: Partial<NostrEvent> = {}
): NostrEvent {
  const request = {
    kind: 9734,
    pubkey: 'sender'.padEnd(64, '0'),
    content: '',
    tags: [['amount', '21000'], ...requestTags],
  };

  return {
    id: 'r'.repeat(64),
    kind: 9735,
    pubkey: 'provider'.padEnd(64, '0'),
    created_at: seconds,
    content: '',
    tags: [
      ['description', JSON.stringify(request)],
      ['bolt11', 'lnbc210n1'],
    ],
    sig: '',
    ...over,
  };
}

describe('earningFrom', () => {
  it('reads a note zap', () => {
    const earning = earningFrom(receipt([['e', 'note-1']]));

    expect(earning?.source).toBe('note');
    expect(earning?.target).toBe('note-1');
    expect(earning?.sats).toBe(21);
  });

  it('reads an article zap from its coordinate', () => {
    /*
     * The obvious implementation reads `e` only, and reports every article zap
     * as a profile zap — an addressable event is referenced by `a` and often
     * carries no `e` at all.
     */
    const earning = earningFrom(receipt([['a', '30023:abc:my-post']]));

    expect(earning?.source).toBe('article');
    expect(earning?.target).toBe('30023:abc:my-post');
  });

  it('prefers the coordinate when a receipt carries both', () => {
    const earning = earningFrom(
      receipt([['a', '30023:abc:my-post'], ['e', 'note-1']])
    );

    expect(earning?.source).toBe('article');
  });

  it('reads a profile zap from having no target at all', () => {
    const earning = earningFrom(receipt([['p', 'me']]));

    expect(earning?.source).toBe('profile');
    expect(earning?.target).toBeUndefined();
  });

  it('names the sender from the signed request, not the receipt', () => {
    // The receipt is signed by the lightning server; the request inside it is
    // signed by whoever paid
    expect(earningFrom(receipt([['e', 'n']]))?.senderPubkey).toBe(
      'sender'.padEnd(64, '0')
    );
  });

  it('declines a receipt with no readable amount', () => {
    const noAmount = receipt([['e', 'n']]);
    const stripped = {
      ...noAmount,
      tags: noAmount.tags.filter(([name]) => name !== 'bolt11'),
    };

    expect(
      earningFrom({
        ...stripped,
        tags: [
          ['description', JSON.stringify({ kind: 9734, pubkey: 'x', tags: [] })],
        ],
      })
    ).toBeNull();
  });

  it('survives a description that is not JSON', () => {
    const broken: NostrEvent = {
      ...receipt([['e', 'n']]),
      tags: [['description', 'not json'], ['bolt11', 'lnbc210n1']],
    };

    // Unreadable target, but the money still arrived — counted as a profile zap
    expect(earningFrom(broken)).toBeNull();
  });
});

describe('summarizeStudio', () => {
  const earning = (over: Partial<Earning> = {}): Earning => ({
    receiptId: Math.random().toString(),
    sats: 100,
    senderPubkey: 'alice',
    at: seconds - DAY,
    source: 'note',
    target: 'note-1',
    ...over,
  });

  it('has nothing to say about nothing', () => {
    expect(summarizeStudio([], 30, NOW)).toEqual(EMPTY_SUMMARY);
  });

  it('adds up the period', () => {
    const summary = summarizeStudio(
      [earning({ sats: 100 }), earning({ sats: 250 })],
      30,
      NOW
    );

    expect(summary.sats).toBe(350);
    expect(summary.payments).toBe(2);
  });

  it('leaves out anything older than the window', () => {
    const summary = summarizeStudio(
      [earning({ sats: 100 }), earning({ sats: 999, at: seconds - 60 * DAY })],
      30,
      NOW
    );

    expect(summary.sats).toBe(100);
  });

  it('counts people, and which of them came back', () => {
    const summary = summarizeStudio(
      [
        earning({ senderPubkey: 'alice' }),
        earning({ senderPubkey: 'alice' }),
        earning({ senderPubkey: 'bob' }),
      ],
      30,
      NOW
    );

    expect(summary.zappers).toBe(2);
    expect(summary.repeatZappers).toBe(1);
  });

  it('compares against the window immediately before', () => {
    const summary = summarizeStudio(
      [
        earning({ sats: 150 }),
        earning({ sats: 100, at: seconds - 40 * DAY }),
      ],
      30,
      NOW
    );

    expect(summary.previousSats).toBe(100);
    expect(summary.change).toBe(50);
  });

  it('reports a fall as a fall', () => {
    const summary = summarizeStudio(
      [earning({ sats: 50 }), earning({ sats: 100, at: seconds - 40 * DAY })],
      30,
      NOW
    );

    expect(summary.change).toBe(-50);
  });

  it('has no opinion when there is nothing to compare against', () => {
    /*
     * A first month is not "up 0%" and it is not up infinitely either. It is a
     * month with no previous month, and saying so is the honest answer.
     */
    expect(summarizeStudio([earning({ sats: 500 })], 30, NOW).change).toBeNull();
  });

  it('splits by where the sats came from, biggest first', () => {
    const summary = summarizeStudio(
      [
        earning({ sats: 100, source: 'note' }),
        earning({ sats: 300, source: 'article', target: '30023:a:b' }),
        earning({ sats: 100, source: 'profile', target: undefined }),
      ],
      30,
      NOW
    );

    expect(summary.bySource.map((row) => row.source)).toEqual([
      'article',
      'note',
      'profile',
    ]);
    expect(summary.bySource[0].share).toBe(60);
  });

  it('ranks what earned most', () => {
    const summary = summarizeStudio(
      [
        earning({ sats: 100, target: 'note-a' }),
        earning({ sats: 900, target: 'note-b' }),
        earning({ sats: 100, target: 'note-a' }),
      ],
      30,
      NOW
    );

    expect(summary.topTargets[0]).toMatchObject({
      target: 'note-b',
      sats: 900,
      payments: 1,
    });
    expect(summary.topTargets[1]).toMatchObject({
      target: 'note-a',
      sats: 200,
      payments: 2,
    });
  });

  it('leaves profile zaps out of the ranking, having nothing to rank', () => {
    const summary = summarizeStudio(
      [earning({ source: 'profile', target: undefined })],
      30,
      NOW
    );

    expect(summary.topTargets).toEqual([]);
    expect(summary.sats).toBe(100);
  });
});

describe('describeSource', () => {
  it('names each source', () => {
    expect(describeSource('note')).toBe('Zaps on notes');
    expect(describeSource('article')).toBe('Zaps on articles');
    expect(describeSource('profile')).toBe('Zaps on your profile');
  });
});

describe('dailyEarnings', () => {
  const DAY = 86400;
  const today = Math.floor(NOW / 1000 / DAY) * DAY;

  const at = (day: number, sats = 100): Earning => ({
    receiptId: `${day}-${sats}`,
    sats,
    senderPubkey: 'alice',
    at: today - day * DAY + 3600,
    source: 'note',
    target: 'note-1',
  });

  it('gives one bucket per day of the window', () => {
    expect(dailyEarnings([], 7, NOW)).toHaveLength(7);
  });

  it('keeps the days nothing arrived', () => {
    /*
     * The empty days are the point. Dropping them turns a line into a lie —
     * three payments in a month would draw as a steady rise across three
     * evenly spaced points, when what happened is a flat month with spikes.
     */
    const days = dailyEarnings([at(0), at(6)], 7, NOW);

    expect(days.map((d) => d.sats)).toEqual([100, 0, 0, 0, 0, 0, 100]);
  });

  it('runs oldest to newest', () => {
    const days = dailyEarnings([], 3, NOW);
    expect(days[0].day).toBeLessThan(days[2].day);
  });

  it('adds up everything that landed on one day', () => {
    const days = dailyEarnings([at(1, 100), at(1, 250)], 3, NOW);
    const day = days.find((entry) => entry.sats > 0);

    expect(day?.sats).toBe(350);
    expect(day?.payments).toBe(2);
  });

  it('ignores anything outside the window', () => {
    expect(dailyEarnings([at(90)], 7, NOW).every((d) => d.sats === 0)).toBe(true);
  });
});
