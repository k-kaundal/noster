import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatMonthYear,
  formatTime,
  isSameDay,
  timeAgo,
  relativeTime,
} from './time';

const NOW = Date.parse('2026-08-08T12:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('timeAgo', () => {
  it('says now for anything under a minute', () => {
    expect(timeAgo(NOW - 30_000, NOW)).toBe('now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(timeAgo(NOW - 12 * MINUTE, NOW)).toBe('12m');
    expect(timeAgo(NOW - 5 * HOUR, NOW)).toBe('5h');
    expect(timeAgo(NOW - 3 * DAY, NOW)).toBe('3d');
  });

  it('rounds down, so nothing reads as older than it is', () => {
    expect(timeAgo(NOW - (2 * HOUR - 1), NOW)).toBe('1h');
  });

  it('switches to a date past a week', () => {
    expect(timeAgo(NOW - 30 * DAY, NOW)).toMatch(/Jul/);
  });

  it('includes the year only when it differs', () => {
    expect(timeAgo(NOW - 400 * DAY, NOW)).toMatch(/2025/);
    expect(timeAgo(NOW - 30 * DAY, NOW)).not.toMatch(/2026/);
  });

  it('reads a slightly future timestamp as new rather than negative', () => {
    // Relay and reader clocks drift; a note stamped 20 seconds ahead is not
    // "-1m old"
    expect(timeAgo(NOW + 20_000, NOW)).toBe('now');
  });

  it('accepts a Date as well as a number', () => {
    expect(timeAgo(new Date(NOW - 5 * HOUR), NOW)).toBe('5h');
  });
});

describe('relativeTime', () => {
  it('spells the age out', () => {
    expect(relativeTime(NOW - 2 * HOUR, NOW)).toMatch(/2 hours ago/);
    expect(relativeTime(NOW - 3 * DAY, NOW)).toMatch(/3 days ago/);
  });

  it('has its own wording for the last minute', () => {
    expect(relativeTime(NOW - 5_000, NOW)).toBe('just now');
  });

  it('reaches months and years', () => {
    expect(relativeTime(NOW - 90 * DAY, NOW)).toMatch(/month/);
    expect(relativeTime(NOW - 800 * DAY, NOW)).toMatch(/year/);
  });

  it('reads forwards too, for something that has not happened yet', () => {
    // A poll closing later today is the same sum as a note posted earlier
    // today; treating the future as zero left polls "closing just now" for
    // their entire open period
    expect(relativeTime(NOW + 2 * HOUR, NOW)).toMatch(/in 2 hours/);
    expect(relativeTime(NOW + 3 * DAY, NOW)).toMatch(/in 3 days/);
  });
});

describe('formatDate and formatMonthYear', () => {
  it('writes a full date', () => {
    expect(formatDate(NOW)).toMatch(/2026/);
    expect(formatDate(NOW)).toMatch(/August|Aug/);
  });

  it('writes a month and year', () => {
    expect(formatMonthYear(NOW)).toMatch(/2026/);
  });
});

describe('formatTime', () => {
  it('uses a 24-hour clock', () => {
    expect(formatTime(Date.parse('2026-08-08T14:05:00'))).toBe('14:05');
  });

  it('pads the hour', () => {
    expect(formatTime(Date.parse('2026-08-08T04:05:00'))).toBe('04:05');
  });
});

describe('isSameDay', () => {
  it('matches two times on one day', () => {
    expect(
      isSameDay(
        Date.parse('2026-08-08T01:00:00'),
        Date.parse('2026-08-08T23:00:00')
      )
    ).toBe(true);
  });

  it('separates adjacent days', () => {
    expect(
      isSameDay(
        Date.parse('2026-08-08T23:59:00'),
        Date.parse('2026-08-09T00:01:00')
      )
    ).toBe(false);
  });
});
