/**
 * Timestamps, formatted the way a timeline reads them.
 *
 * Replaces date-fns, which was 55 KB of the first chunk to render "2h". Every
 * function here is a thin layer over `Intl`, which the browser already has and
 * which localises properly — date-fns formatted month names in English unless
 * a locale was imported alongside, and none ever was.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Accepts a Date, epoch milliseconds, or nothing. */
function toDate(input: Date | number): Date {
  return input instanceof Date ? input : new Date(input);
}

/**
 * A compact age, as a timeline shows it: `now`, `12m`, `5h`, `3d`, `8 Aug`.
 *
 * Short by design. A column of "about 3 hours ago" is mostly the words "about"
 * and "ago" repeated down the page, and the number is the only part anyone
 * reads.
 */
export function timeAgo(input: Date | number, now = Date.now()): string {
  const date = toDate(input);
  const elapsed = now - date.getTime();

  // Clock skew between a relay and the reader is normal and small; a note
  // stamped slightly in the future should read as new, not as a negative age
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;

  const sameYear = date.getFullYear() === new Date(now).getFullYear();

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/**
 * The same distance in words, in either direction: `2 hours ago`, `in 3 days`.
 *
 * For the places where the time is the subject rather than a footnote — a
 * notification, a poll's closing time — and there is room to say it. Both
 * directions matter: a poll that ends later today is the same calculation as a
 * note posted earlier today, and treating a future timestamp as zero would
 * have polls closing "just now" for the whole time they are open.
 */
export function relativeTime(input: Date | number, now = Date.now()): string {
  const elapsed = now - toDate(input).getTime();
  const distance = Math.abs(elapsed);
  // Intl reads a negative value as the past and a positive one as the future
  const direction = elapsed >= 0 ? -1 : 1;

  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  const say = (unit: Intl.RelativeTimeFormatUnit, size: number) =>
    relative.format(direction * Math.floor(distance / size), unit);

  if (distance < MINUTE) return elapsed >= 0 ? 'just now' : 'in a moment';
  if (distance < HOUR) return say('minute', MINUTE);
  if (distance < DAY) return say('hour', HOUR);
  if (distance < 30 * DAY) return say('day', DAY);
  if (distance < 365 * DAY) return say('month', 30 * DAY);

  return say('year', 365 * DAY);
}

/** A full date, e.g. `8 August 2026`. Used for day separators. */
export function formatDate(input: Date | number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(
    toDate(input)
  );
}

/** Month and year, e.g. `August 2026`. */
export function formatMonthYear(input: Date | number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(toDate(input));
}

/** A 24-hour clock time, e.g. `14:05`. */
export function formatTime(input: Date | number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(toDate(input));
}

/** Whether two timestamps fall on the same calendar day, locally. */
export function isSameDay(a: Date | number, b: Date | number): boolean {
  const first = toDate(a);
  const second = toDate(b);

  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

/** A full timestamp for a `title` attribute, where the compact one is not enough. */
export function fullTimestamp(input: Date | number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(toDate(input));
}
