import { hasPassed, startsAt, type CalendarEvent } from '@/lib/nip52';

/**
 * The headings a list of events is filed under, in the order they read.
 *
 * "Happening now" is first because it is the one that changes what somebody
 * does: an event they can still walk into beats one that starts in six hours.
 */
export const GROUP_ORDER = [
  'Happening now',
  'Today',
  'This week',
  'This month',
  'Later',
  'Past',
] as const;

export type CalendarGroup = (typeof GROUP_ORDER)[number];

/**
 * Groups events under a heading a person thinks in.
 *
 * "Today" and "This week" beat a wall of dates, and the boundaries are local —
 * computed from the reader's own midnight, so an event at 23:00 tonight is
 * today rather than tomorrow for somebody east of the publisher.
 *
 * Lives here rather than in the page because it is the part with a wrong
 * answer worth catching, and importing a page to test a comparison drags in
 * the whole app.
 */
export function groupByWhen(
  events: CalendarEvent[],
  now = new Date()
): [CalendarGroup, CalendarEvent[]][] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const endOfWeek = new Date(endOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const endOfMonth = new Date(endOfToday);
  endOfMonth.setMonth(endOfMonth.getMonth() + 1);

  const groups = new Map<CalendarGroup, CalendarEvent[]>(
    GROUP_ORDER.map((name) => [name, []])
  );

  const seconds = now.getTime() / 1000;

  for (const event of events) {
    const at = startsAt(event) * 1000;

    /*
     * The lower bound is the fix. "Today" was `at <= endOfToday` with nothing
     * beneath it, so every event that had already begun and not yet finished
     * fell into it — a four-day offsite starting on the 11th was filed under
     * "Today" on the 13th, directly above a line reading "11 – 14 Aug".
     * Anything already running says so instead, which is both true and the
     * more useful heading.
     */
    const bucket: CalendarGroup = hasPassed(event, seconds)
      ? 'Past'
      : at < startOfToday.getTime()
        ? 'Happening now'
        : at <= endOfToday.getTime()
          ? 'Today'
          : at <= endOfWeek.getTime()
            ? 'This week'
            : at <= endOfMonth.getTime()
              ? 'This month'
              : 'Later';

    groups.get(bucket)!.push(event);
  }

  return [...groups].filter(([, list]) => list.length > 0);
}
