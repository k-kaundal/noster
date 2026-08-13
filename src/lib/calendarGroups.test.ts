import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { groupByWhen } from './calendarGroups';
import {
  DATE_EVENT_KIND,
  TIME_EVENT_KIND,
  parseCalendarEvent,
  type CalendarEvent,
} from '@/lib/nip52';

function parse(kind: number, tags: string[][]): CalendarEvent {
  const event: NostrEvent = {
    id: '0'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 0,
    kind,
    tags: [['d', Math.random().toString(36)], ['title', 'T'], ...tags],
    content: '',
    sig: '',
  };

  const parsed = parseCalendarEvent(event);
  if (!parsed) throw new Error('fixture did not parse');
  return parsed;
}

/** Local noon, so the assertions never sit on a midnight boundary. */
function at(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour);
}

/** The heading a given event lands under, for a given "now". */
function headingFor(event: CalendarEvent, now: Date): string | undefined {
  return groupByWhen([event], now).find(([, list]) => list.length > 0)?.[0];
}

describe('groupByWhen', () => {
  const now = at(2026, 8, 13);

  it('files a multi-day event already under way as happening now', () => {
    /**
     * The bug this was written for. "Today" was an upper bound with nothing
     * beneath it, so anything that had started and not yet finished fell into
     * it — a four-day offsite from the 11th sat under "Today" on the 13th,
     * directly above a line reading "11 – 14 Aug".
     */
    const offsite = parse(DATE_EVENT_KIND, [
      ['start', '2026-08-11'],
      ['end', '2026-08-15'],
    ]);

    expect(headingFor(offsite, now)).toBe('Happening now');
  });

  it('files something starting later today under Today', () => {
    const tonight = parse(TIME_EVENT_KIND, [
      ['start', String(at(2026, 8, 13, 19).getTime() / 1000)],
    ]);

    expect(headingFor(tonight, now)).toBe('Today');
  });

  it('files something earlier today under Today, not Happening now', () => {
    // Started this morning, ends this evening: still today, and "today" is
    // what somebody scanning the page is looking for
    const morning = parse(TIME_EVENT_KIND, [
      ['start', String(at(2026, 8, 13, 9).getTime() / 1000)],
      ['end', String(at(2026, 8, 13, 18).getTime() / 1000)],
    ]);

    expect(headingFor(morning, now)).toBe('Today');
  });

  it('files a finished event under Past', () => {
    const done = parse(DATE_EVENT_KIND, [
      ['start', '2026-08-01'],
      ['end', '2026-08-03'],
    ]);

    expect(headingFor(done, now)).toBe('Past');
  });

  it('keeps the later buckets in order', () => {
    const soon = parse(DATE_EVENT_KIND, [['start', '2026-08-16']]);
    const thisMonth = parse(DATE_EVENT_KIND, [['start', '2026-09-05']]);
    const later = parse(DATE_EVENT_KIND, [['start', '2027-01-01']]);

    expect(headingFor(soon, now)).toBe('This week');
    expect(headingFor(thisMonth, now)).toBe('This month');
    expect(headingFor(later, now)).toBe('Later');
  });

  it('drops empty headings rather than printing them', () => {
    expect(groupByWhen([], now)).toEqual([]);
  });

  it('lists what is running before what has not started', () => {
    const running = parse(DATE_EVENT_KIND, [
      ['start', '2026-08-11'],
      ['end', '2026-08-15'],
    ]);
    const tonight = parse(TIME_EVENT_KIND, [
      ['start', String(at(2026, 8, 13, 19).getTime() / 1000)],
    ]);

    expect(groupByWhen([tonight, running], now).map(([name]) => name)).toEqual([
      'Happening now',
      'Today',
    ]);
  });
});
