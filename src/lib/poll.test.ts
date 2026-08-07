import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  POLL_KIND,
  POLL_RESPONSE_KIND,
  buildPollTags,
  isPollClosed,
  optionShare,
  parsePoll,
  tallyPoll,
} from './poll';

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'poll-id',
    pubkey: 'author',
    created_at: 1000,
    kind: POLL_KIND,
    tags: [],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}

/** The example poll from NIP-88. */
const specPoll = makeEvent({
  content: 'Pineapple on pizza',
  tags: [
    ['option', 'qj518h583', 'Yay'],
    ['option', 'gga6cdnqj', 'Nay'],
    ['relay', 'wss://relay.example.com'],
    ['polltype', 'singlechoice'],
  ],
});

function response(
  pubkey: string,
  optionIds: string[],
  createdAt = 2000
): NostrEvent {
  return makeEvent({
    id: `${pubkey}-${createdAt}`,
    pubkey,
    kind: POLL_RESPONSE_KIND,
    created_at: createdAt,
    tags: [['e', 'poll-id'], ...optionIds.map((id) => ['response', id])],
  });
}

describe('parsePoll', () => {
  it('parses the poll from the NIP-88 example', () => {
    const poll = parsePoll(specPoll)!;

    expect(poll.question).toBe('Pineapple on pizza');
    expect(poll.options).toEqual([
      { id: 'qj518h583', label: 'Yay' },
      { id: 'gga6cdnqj', label: 'Nay' },
    ]);
    expect(poll.type).toBe('singlechoice');
    expect(poll.relays).toEqual(['wss://relay.example.com']);
  });

  it('defaults to single choice when polltype is absent', () => {
    const poll = parsePoll(
      makeEvent({
        tags: [
          ['option', 'a', 'A'],
          ['option', 'b', 'B'],
        ],
      })
    )!;
    expect(poll.type).toBe('singlechoice');
  });

  it('rejects a poll with fewer than two options', () => {
    expect(parsePoll(makeEvent({ tags: [['option', 'a', 'Only']] }))).toBeNull();
    expect(parsePoll(makeEvent({ tags: [] }))).toBeNull();
  });

  it('ignores events of another kind', () => {
    expect(parsePoll(makeEvent({ kind: 1 }))).toBeNull();
  });
});

describe('tallyPoll', () => {
  const poll = parsePoll(specPoll)!;

  it('counts one vote per option', () => {
    const tally = tallyPoll(poll, [
      response('alice', ['qj518h583']),
      response('bob', ['gga6cdnqj']),
      response('carol', ['qj518h583']),
    ]);

    expect(tally.counts).toEqual({ qj518h583: 2, gga6cdnqj: 1 });
    expect(tally.total).toBe(3);
  });

  it('keeps only a voter’s latest response', () => {
    // Otherwise anyone could inflate a result by voting repeatedly
    const tally = tallyPoll(poll, [
      response('alice', ['qj518h583'], 2000),
      response('alice', ['gga6cdnqj'], 3000),
      response('alice', ['gga6cdnqj'], 2500),
    ]);

    expect(tally.total).toBe(1);
    expect(tally.counts).toEqual({ qj518h583: 0, gga6cdnqj: 1 });
  });

  it('counts only the first choice on a single-choice poll', () => {
    const tally = tallyPoll(poll, [
      response('alice', ['qj518h583', 'gga6cdnqj']),
    ]);

    expect(tally.counts).toEqual({ qj518h583: 1, gga6cdnqj: 0 });
    expect(tally.total).toBe(1);
  });

  it('counts every distinct choice on a multiple-choice poll', () => {
    const multi = parsePoll(
      makeEvent({
        tags: [
          ['option', 'a', 'A'],
          ['option', 'b', 'B'],
          ['polltype', 'multiplechoice'],
        ],
      })
    )!;

    const tally = tallyPoll(multi, [
      // The duplicate must not count twice
      response('alice', ['a', 'b', 'a']),
    ]);

    expect(tally.counts).toEqual({ a: 1, b: 1 });
    expect(tally.total).toBe(1);
  });

  it('ignores option ids the poll never offered', () => {
    // A crafted response must not be able to invent a choice
    const tally = tallyPoll(poll, [response('mallory', ['not-an-option'])]);

    expect(tally.total).toBe(0);
    expect(tally.counts).toEqual({ qj518h583: 0, gga6cdnqj: 0 });
  });

  it('discards votes cast after the poll closed', () => {
    const closing = parsePoll(
      makeEvent({
        tags: [
          ['option', 'a', 'A'],
          ['option', 'b', 'B'],
          ['endsAt', '2500'],
        ],
      })
    )!;

    const tally = tallyPoll(closing, [
      response('alice', ['a'], 2400),
      response('bob', ['b'], 2600),
    ]);

    expect(tally.total).toBe(1);
    expect(tally.counts).toEqual({ a: 1, b: 0 });
  });

  it('reports the viewer’s own choices', () => {
    const tally = tallyPoll(
      poll,
      [response('alice', ['qj518h583']), response('bob', ['gga6cdnqj'])],
      'bob'
    );

    expect(tally.ownChoices).toEqual(['gga6cdnqj']);
  });

  it('ignores events that are not poll responses', () => {
    const tally = tallyPoll(poll, [
      makeEvent({ kind: 1, pubkey: 'alice', tags: [['response', 'qj518h583']] }),
    ]);
    expect(tally.total).toBe(0);
  });
});

describe('optionShare', () => {
  it('returns a rounded percentage', () => {
    const tally = { counts: { a: 1, b: 2 }, total: 3, ownChoices: [] };
    expect(optionShare(tally, 'a')).toBe(33);
    expect(optionShare(tally, 'b')).toBe(67);
  });

  it('is zero when nobody has voted, rather than NaN', () => {
    expect(optionShare({ counts: {}, total: 0, ownChoices: [] }, 'a')).toBe(0);
  });
});

describe('isPollClosed', () => {
  it('is open without an end time', () => {
    const poll = parsePoll(specPoll)!;
    expect(isPollClosed(poll, 9_999_999)).toBe(false);
  });

  it('closes once the end time passes', () => {
    const poll = parsePoll(
      makeEvent({
        tags: [
          ['option', 'a', 'A'],
          ['option', 'b', 'B'],
          ['endsAt', '1000'],
        ],
      })
    )!;

    expect(isPollClosed(poll, 999)).toBe(false);
    expect(isPollClosed(poll, 1001)).toBe(true);
  });
});

describe('buildPollTags', () => {
  it('emits an option tag per choice with unique ids', () => {
    const tags = buildPollTags({
      choices: ['Yay', 'Nay', '  '],
      type: 'singlechoice',
    });

    const options = tags.filter(([name]) => name === 'option');
    expect(options).toHaveLength(2);
    expect(options.map(([, , label]) => label)).toEqual(['Yay', 'Nay']);
    expect(options[0][1]).not.toBe(options[1][1]);
  });

  it('round-trips through the parser', () => {
    const tags = buildPollTags({
      choices: ['One', 'Two'],
      type: 'multiplechoice',
      endsAt: 4000,
    });

    const poll = parsePoll(makeEvent({ content: 'Q?', tags }))!;
    expect(poll.type).toBe('multiplechoice');
    expect(poll.endsAt).toBe(4000);
    expect(poll.options.map((option) => option.label)).toEqual(['One', 'Two']);
  });
});
