import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  DATE_EVENT_KIND,
  SECONDS_IN_DAY,
  TIME_EVENT_KIND,
  dateEventTags,
  dayIndexes,
  formatCalendarDate,
  isDateBased,
  lastDay,
  latestRsvps,
  parseCalendar,
  parseCalendarDate,
  parseCalendarEvent,
  parseRsvp,
  rsvpTags,
  tallyRsvps,
  timeEventTags,
  type DateBasedEvent,
  type Rsvp,
} from './nip52';

function event(kind: number, tags: string[][], overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '0'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 0,
    kind,
    tags,
    content: '',
    sig: '',
    ...overrides,
  };
}

function dateEvent(start: string, end?: string): DateBasedEvent {
  const tags = [['d', 'x'], ['title', 'T'], ['start', start]];
  if (end) tags.push(['end', end]);

  const parsed = parseCalendarEvent(event(DATE_EVENT_KIND, tags));
  if (!parsed || !isDateBased(parsed)) throw new Error('not a date event');
  return parsed;
}

describe('parseCalendarDate', () => {
  it('reads a valid ISO date', () => {
    expect(parseCalendarDate('2026-01-01')).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
  });

  it('rejects days that do not exist', () => {
    expect(parseCalendarDate('2026-02-31')).toBeNull();
    expect(parseCalendarDate('2026-13-01')).toBeNull();
    expect(parseCalendarDate('2026-00-10')).toBeNull();
  });

  it('rejects anything that is not zero-padded ISO', () => {
    expect(parseCalendarDate('2026-1-1')).toBeNull();
    expect(parseCalendarDate('01/01/2026')).toBeNull();
    expect(parseCalendarDate('')).toBeNull();
  });

  it('keeps the written day whatever the local timezone is', () => {
    // `new Date('2026-01-01')` is UTC midnight, which is Dec 31 in the Americas
    const parsed = parseCalendarDate('2026-01-01')!;
    expect(formatCalendarDate(parsed)).toBe('2026-01-01');
  });
});

describe('lastDay', () => {
  it('treats the end tag as exclusive', () => {
    // Jan 1 to Jan 3 exclusive covers the 1st and the 2nd
    expect(formatCalendarDate(lastDay(dateEvent('2026-01-01', '2026-01-03')))).toBe(
      '2026-01-02'
    );
  });

  it('ends on the start date when no end is given', () => {
    expect(formatCalendarDate(lastDay(dateEvent('2026-12-25')))).toBe(
      '2026-12-25'
    );
  });

  it('ignores an end that is not after the start', () => {
    expect(formatCalendarDate(lastDay(dateEvent('2026-01-05', '2026-01-05')))).toBe(
      '2026-01-05'
    );
    expect(formatCalendarDate(lastDay(dateEvent('2026-01-05', '2026-01-01')))).toBe(
      '2026-01-05'
    );
  });

  it('crosses a month boundary', () => {
    expect(formatCalendarDate(lastDay(dateEvent('2026-01-30', '2026-02-02')))).toBe(
      '2026-02-01'
    );
  });
});

describe('dateEventTags', () => {
  it('converts an inclusive last day into the exclusive end tag', () => {
    const tags = dateEventTags({
      slug: 'x',
      title: 'T',
      start: { year: 2026, month: 1, day: 1 },
      through: { year: 2026, month: 1, day: 2 },
    });

    expect(tags).toContainEqual(['end', '2026-01-03']);
  });

  it('round-trips through the parser', () => {
    const tags = dateEventTags({
      slug: 'x',
      title: 'T',
      start: { year: 2026, month: 3, day: 7 },
      through: { year: 2026, month: 3, day: 9 },
    });

    const parsed = parseCalendarEvent(event(DATE_EVENT_KIND, tags))!;
    expect(isDateBased(parsed) && formatCalendarDate(lastDay(parsed))).toBe(
      '2026-03-09'
    );
  });

  it('writes no end tag for a single day', () => {
    const tags = dateEventTags({
      slug: 'x',
      title: 'T',
      start: { year: 2026, month: 1, day: 1 },
    });

    expect(tags.some(([name]) => name === 'end')).toBe(false);
  });
});

describe('dayIndexes', () => {
  const base = 82549 * SECONDS_IN_DAY;

  it('gives one index for an event inside a day', () => {
    expect(dayIndexes(base + 3600, base + 7200)).toEqual(['82549']);
  });

  it('does not tag the day an exclusive end lands on', () => {
    expect(dayIndexes(base, base + SECONDS_IN_DAY)).toEqual(['82549']);
  });

  it('covers every day an event touches', () => {
    // 01:00 on the first day through 01:00 two days later — three days touched
    expect(
      dayIndexes(base + 3600, base + 2 * SECONDS_IN_DAY + 3600)
    ).toEqual(['82549', '82550', '82551']);
  });

  it('stops at the last day with time actually on it', () => {
    // Ends at midnight opening day 82551, so nothing happens on that day
    expect(dayIndexes(base + 3600, base + 2 * SECONDS_IN_DAY)).toEqual([
      '82549',
      '82550',
    ]);
  });

  it('gives one index when there is no end', () => {
    expect(dayIndexes(base + 3600)).toEqual(['82549']);
  });

  it('refuses to emit an unbounded number of tags', () => {
    expect(dayIndexes(base, base + 5000 * SECONDS_IN_DAY)).toHaveLength(366);
  });
});

describe('timeEventTags', () => {
  it('includes the D day index', () => {
    const tags = timeEventTags({ slug: 'x', title: 'T', start: 82549 * SECONDS_IN_DAY });
    expect(tags).toContainEqual(['D', '82549']);
  });

  it('omits an end that is not after the start', () => {
    const tags = timeEventTags({ slug: 'x', title: 'T', start: 100, end: 100 });
    expect(tags.some(([name]) => name === 'end')).toBe(false);
  });

  it('writes end_tzid only when it differs from the start zone', () => {
    const same = timeEventTags({
      slug: 'x',
      title: 'T',
      start: 100,
      startTzid: 'Europe/London',
      endTzid: 'Europe/London',
    });
    expect(same.some(([name]) => name === 'end_tzid')).toBe(false);

    const crossing = timeEventTags({
      slug: 'x',
      title: 'T',
      start: 100,
      startTzid: 'Europe/London',
      endTzid: 'America/New_York',
    });
    expect(crossing).toContainEqual(['end_tzid', 'America/New_York']);
  });
});

describe('parseCalendarEvent', () => {
  it('requires d, title and start', () => {
    expect(
      parseCalendarEvent(event(DATE_EVENT_KIND, [['title', 'T'], ['start', '2026-01-01']]))
    ).toBeNull();
    expect(
      parseCalendarEvent(event(DATE_EVENT_KIND, [['d', 'x'], ['start', '2026-01-01']]))
    ).toBeNull();
    expect(
      parseCalendarEvent(event(DATE_EVENT_KIND, [['d', 'x'], ['title', 'T']]))
    ).toBeNull();
  });

  it('falls back to the deprecated name tag', () => {
    const parsed = parseCalendarEvent(
      event(DATE_EVENT_KIND, [['d', 'x'], ['name', 'Old style'], ['start', '2026-01-01']])
    );

    expect(parsed?.title).toBe('Old style');
  });

  it('inherits end_tzid from start_tzid', () => {
    const parsed = parseCalendarEvent(
      event(TIME_EVENT_KIND, [
        ['d', 'x'],
        ['title', 'T'],
        ['start', '1700000000'],
        ['start_tzid', 'America/Costa_Rica'],
      ])
    );

    expect(parsed && !isDateBased(parsed) && parsed.endTzid).toBe(
      'America/Costa_Rica'
    );
  });

  it('drops an end that precedes the start', () => {
    const parsed = parseCalendarEvent(
      event(TIME_EVENT_KIND, [
        ['d', 'x'],
        ['title', 'T'],
        ['start', '1700003600'],
        ['end', '1700000000'],
      ])
    );

    expect(parsed && !isDateBased(parsed) && parsed.end).toBeUndefined();
  });

  it('rejects a start that will not parse', () => {
    expect(
      parseCalendarEvent(event(TIME_EVENT_KIND, [['d', 'x'], ['title', 'T'], ['start', 'soon']]))
    ).toBeNull();
  });

  it('reads participants with their roles', () => {
    const parsed = parseCalendarEvent(
      event(TIME_EVENT_KIND, [
        ['d', 'x'],
        ['title', 'T'],
        ['start', '1700000000'],
        ['p', 'b'.repeat(64), 'wss://relay.example', 'speaker'],
      ])
    );

    expect(parsed?.participants).toEqual([
      { pubkey: 'b'.repeat(64), relay: 'wss://relay.example', role: 'speaker' },
    ]);
  });
});

describe('parseRsvp', () => {
  const base = [
    ['d', 'r'],
    ['a', `${TIME_EVENT_KIND}:${'a'.repeat(64)}:x`],
  ];

  it('ignores fb on a declined RSVP', () => {
    const parsed = parseRsvp(
      event(31925, [...base, ['status', 'declined'], ['fb', 'busy']])
    );

    expect(parsed?.status).toBe('declined');
    expect(parsed?.freeBusy).toBeUndefined();
  });

  it('keeps fb on an accepted RSVP', () => {
    const parsed = parseRsvp(
      event(31925, [...base, ['status', 'accepted'], ['fb', 'busy']])
    );

    expect(parsed?.freeBusy).toBe('busy');
  });

  it('rejects an unknown status', () => {
    expect(parseRsvp(event(31925, [...base, ['status', 'perhaps']]))).toBeNull();
  });

  it('requires d, a and status', () => {
    expect(parseRsvp(event(31925, [...base]))).toBeNull();
    expect(parseRsvp(event(31925, [['d', 'r'], ['status', 'accepted']]))).toBeNull();
  });

  it('ignores an a tag that does not point at a calendar event', () => {
    expect(
      parseRsvp(event(31925, [['d', 'r'], ['a', `30023:${'a'.repeat(64)}:x`], ['status', 'accepted']]))
    ).toBeNull();
  });
});

describe('rsvpTags', () => {
  const address = `${TIME_EVENT_KIND}:${'a'.repeat(64)}:x`;

  it('omits fb when declining', () => {
    const tags = rsvpTags({ address, status: 'declined', freeBusy: 'busy' });
    expect(tags.some(([name]) => name === 'fb')).toBe(false);
  });

  it('reuses the same d so a changed answer replaces the old one', () => {
    const first = rsvpTags({ address, status: 'accepted' });
    const second = rsvpTags({ address, status: 'declined' });

    const slugOf = (tags: string[][]) =>
      tags.find(([name]) => name === 'd')?.[1];

    expect(slugOf(first)).toBe(slugOf(second));
  });
});

describe('tallyRsvps', () => {
  const address = `${TIME_EVENT_KIND}:${'a'.repeat(64)}:x`;

  function rsvp(pubkey: string, status: string, at: number): Rsvp {
    return parseRsvp(
      event(31925, [['d', `r${at}`], ['a', address], ['status', status]], {
        pubkey,
        created_at: at,
      })
    )!;
  }

  it('counts each person once, taking their latest answer', () => {
    const list = [
      rsvp('b'.repeat(64), 'accepted', 1),
      rsvp('b'.repeat(64), 'declined', 2),
      rsvp('c'.repeat(64), 'accepted', 1),
    ];

    expect(tallyRsvps(list)).toEqual({
      accepted: 1,
      declined: 1,
      tentative: 0,
    });
    expect(latestRsvps(list).get('b'.repeat(64))?.status).toBe('declined');
  });
});

describe('parseCalendar', () => {
  it('keeps only calendar-event addresses', () => {
    const parsed = parseCalendar(
      event(31924, [
        ['d', 'c'],
        ['title', 'Meetups'],
        ['a', `${TIME_EVENT_KIND}:${'a'.repeat(64)}:x`],
        ['a', `30023:${'a'.repeat(64)}:article`],
      ])
    );

    expect(parsed?.entries).toEqual([`${TIME_EVENT_KIND}:${'a'.repeat(64)}:x`]);
  });

  it('requires a title', () => {
    expect(parseCalendar(event(31924, [['d', 'c']]))).toBeNull();
  });
});
