import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  GOAL_KIND,
  buildGoalTags,
  countsTowardGoal,
  goalProgress,
  goalRelays,
  linkedGoal,
  parseZapGoal,
  zapRelaysForGoal,
  type ZapGoal,
} from './nip75';

function event(tags: string[][], content = 'A new microphone'): NostrEvent {
  return {
    id: '0'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1_700_000_000,
    kind: GOAL_KIND,
    tags,
    content,
    sig: '',
  };
}

const RELAY = ['relays', 'wss://relay.example'];

describe('parseZapGoal', () => {
  it('reads a goal with the two tags the spec requires', () => {
    const goal = parseZapGoal(event([RELAY, ['amount', '210000']]));

    expect(goal?.amountMsat).toBe(210_000);
    expect(goal?.relays).toEqual(['wss://relay.example']);
    expect(goal?.description).toBe('A new microphone');
  });

  it('rejects a goal with no amount', () => {
    /**
     * Rejected rather than defaulted. A goal with no target has no progress to
     * show, and inventing one would put a bar on screen measuring nothing.
     */
    expect(parseZapGoal(event([RELAY]))).toBeNull();
    expect(parseZapGoal(event([RELAY, ['amount', '0']]))).toBeNull();
    expect(parseZapGoal(event([RELAY, ['amount', 'lots']]))).toBeNull();
  });

  it('rejects a goal that names no relays', () => {
    /**
     * The failure this prevents is silent and expensive: every zap toward a
     * goal is published to the relays it names, so a goal without them
     * collects money that its own progress bar never sees.
     */
    expect(parseZapGoal(event([['amount', '210000']]))).toBeNull();
  });

  it('rejects a goal whose relays are not websockets', () => {
    // An https entry here reaches an LNURL server as a zap-request relay and
    // is rejected there, which is the same silent loss
    expect(
      parseZapGoal(event([['relays', 'https://relay.example'], ['amount', '1']]))
    ).toBeNull();
  });

  it('reads many relays from one tag and from many tags', () => {
    const many = event([
      ['relays', 'wss://a.example', 'wss://b.example'],
      ['relays', 'wss://c.example'],
      ['amount', '1000'],
    ]);

    expect(parseZapGoal(many)?.relays).toEqual([
      'wss://a.example',
      'wss://b.example',
      'wss://c.example',
    ]);
  });

  it('drops a duplicate relay', () => {
    expect(
      goalRelays(event([['relays', 'wss://a.example', 'wss://a.example']]))
    ).toEqual(['wss://a.example']);
  });

  it('keeps only well-formed beneficiary pubkeys', () => {
    const goal = parseZapGoal(
      event([
        RELAY,
        ['amount', '1000'],
        ['zap', 'b'.repeat(64), 'wss://x.example', '2'],
        ['zap', 'not-a-pubkey'],
      ])
    );

    expect(goal?.beneficiaries).toEqual([
      { pubkey: 'b'.repeat(64), relay: 'wss://x.example', weight: 2 },
    ]);
  });

  it('ignores an event of another kind', () => {
    expect(parseZapGoal({ ...event([RELAY, ['amount', '1']]), kind: 1 })).toBeNull();
  });
});

describe('buildGoalTags', () => {
  it('round-trips through the parser', () => {
    const tags = buildGoalTags({
      description: 'x',
      amountMsat: 210_000,
      relays: ['wss://relay.example'],
    });

    const goal = parseZapGoal(event(tags));

    expect(goal?.amountMsat).toBe(210_000);
    expect(goal?.relays).toEqual(['wss://relay.example']);
  });

  it('writes the amount as a whole number of millisats', () => {
    // The tag is defined in millisats and a fractional one is not a number a
    // relay or another client will agree with
    const tags = buildGoalTags({
      description: 'x',
      amountMsat: 1500.7,
      relays: ['wss://a.example'],
    });

    expect(tags.find(([name]) => name === 'amount')?.[1]).toBe('1501');
  });

  it('refuses to build a goal with no usable relay', () => {
    /**
     * It used to emit a bare `["relays"]` tag with nothing in it. That
     * publishes cleanly, parses as null everywhere, and leaves the author with
     * a goal nobody — including this app — can read or fund.
     */
    expect(() =>
      buildGoalTags({ description: 'x', amountMsat: 1, relays: [] })
    ).toThrow(/relay/i);

    expect(() =>
      buildGoalTags({
        description: 'x',
        amountMsat: 1,
        relays: ['https://relay.example'],
      })
    ).toThrow(/relay/i);
  });

  it('carries the optional fields through', () => {
    const tags = buildGoalTags({
      description: 'x',
      amountMsat: 1000,
      relays: ['wss://a.example'],
      closedAt: 1_800_000_000,
      image: 'https://cdn.example/a.jpg',
      summary: 'Mic fund',
    });

    const goal = parseZapGoal(event(tags));

    expect(goal?.closedAt).toBe(1_800_000_000);
    expect(goal?.image).toBe('https://cdn.example/a.jpg');
    expect(goal?.summary).toBe('Mic fund');
  });
});

describe('goalProgress', () => {
  /** Published at the epoch, so the fixtures below are all "after" it. */
  const goal = {
    amountMsat: 100_000,
    closedAt: undefined,
    event: { created_at: 0 },
  } as ZapGoal;

  const receipt = (amountMsat: number, senderPubkey?: string, createdAt = 0) => ({
    amountMsat,
    senderPubkey,
    createdAt,
  });

  it('adds up what has been raised', () => {
    const progress = goalProgress(goal, [receipt(30_000), receipt(20_000)]);

    expect(progress.raisedMsat).toBe(50_000);
    expect(progress.percent).toBe(50);
    expect(progress.isReached).toBe(false);
  });

  it('rounds down, so one sat short is not shown as done', () => {
    const progress = goalProgress(goal, [receipt(99_999)]);

    expect(progress.percent).toBe(99);
    expect(progress.isReached).toBe(false);
  });

  it('caps the bar at full while still counting the overshoot', () => {
    const progress = goalProgress(goal, [receipt(250_000)]);

    expect(progress.raisedMsat).toBe(250_000);
    expect(progress.fraction).toBe(1);
    expect(progress.isReached).toBe(true);
  });

  it('counts each contributor once, however many times they zapped', () => {
    const progress = goalProgress(goal, [
      receipt(1000, 'b'.repeat(64)),
      receipt(1000, 'b'.repeat(64)),
      receipt(1000, 'c'.repeat(64)),
    ]);

    expect(progress.contributorCount).toBe(2);
  });

  it('leaves out zaps that arrived after the deadline', () => {
    const closing = {
      amountMsat: 100_000,
      closedAt: 500,
      event: { created_at: 0 },
    } as ZapGoal;

    const progress = goalProgress(
      closing,
      [receipt(40_000, undefined, 400), receipt(40_000, undefined, 600)],
      1000
    );

    expect(progress.raisedMsat).toBe(40_000);
    expect(progress.isClosed).toBe(true);
  });

  it('counts a zap that landed exactly on the deadline', () => {
    expect(countsTowardGoal({ closedAt: 500 }, 500)).toBe(true);
    expect(countsTowardGoal({ closedAt: 500 }, 501)).toBe(false);
    expect(countsTowardGoal({ closedAt: undefined }, 9e9)).toBe(true);
  });

  it('leaves out zaps that arrived before the goal was published', () => {
    /**
     * The real case this was written for. A goal is announced in a note, the
     * note's zaps count toward it — and the note is usually older than the
     * goal. Without a lower bound a brand new goal credits itself with
     * everything that note ever earned, and reads as part-funded by money
     * nobody sent toward it.
     */
    expect(countsTowardGoal({ closedAt: undefined, startedAt: 500 }, 499)).toBe(
      false
    );
    expect(countsTowardGoal({ closedAt: undefined, startedAt: 500 }, 500)).toBe(
      true
    );
  });

  it('ignores a zap sent before the goal existed', () => {
    const later = {
      amountMsat: 100_000,
      closedAt: undefined,
      event: { created_at: 1_000 },
    } as ZapGoal;

    const progress = goalProgress(later, [
      receipt(40_000, undefined, 900),
      receipt(10_000, undefined, 1_100),
    ]);

    expect(progress.raisedMsat).toBe(10_000);
    expect(progress.contributorCount).toBe(0);
  });
});

describe('zapRelaysForGoal', () => {
  const goal = {
    relays: ['wss://a.example', 'wss://b.example'],
  } as ZapGoal;

  it("never drops the goal's own relays to fit the cap", () => {
    /**
     * The point of the whole function. Trimming these to a limit meant for the
     * reader's relay list would produce a receipt that exists and a goal that
     * never counts it.
     */
    const relays = zapRelaysForGoal(goal, ['wss://mine.example'], 1);

    expect(relays).toContain('wss://a.example');
    expect(relays).toContain('wss://b.example');
  });

  it('adds the reader relays after, up to the cap', () => {
    const relays = zapRelaysForGoal(
      goal,
      ['wss://mine.example', 'wss://other.example'],
      3
    );

    expect(relays).toEqual([
      'wss://a.example',
      'wss://b.example',
      'wss://mine.example',
    ]);
  });

  it('does not repeat a relay the reader shares with the goal', () => {
    expect(zapRelaysForGoal(goal, ['wss://a.example'], 4)).toEqual([
      'wss://a.example',
      'wss://b.example',
    ]);
  });
});

describe('linkedGoal', () => {
  it('reads the goal an event points at, with its relay hint', () => {
    const article = {
      ...event([['goal', 'f'.repeat(64), 'wss://hint.example']]),
      kind: 30023,
    };

    expect(linkedGoal(article)).toEqual({
      id: 'f'.repeat(64),
      relay: 'wss://hint.example',
    });
  });

  it('returns nothing for an event with no goal', () => {
    expect(linkedGoal({ ...event([]), kind: 1 })).toBeNull();
  });
});
