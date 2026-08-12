import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-52: calendar events.
 *
 * Two kinds for two genuinely different things. A date-based event (31922) is
 * a set of calendar squares — a public holiday is the 25th everywhere, and it
 * does not start at a moment. A time-based event (31923) is an instant on the
 * clock, and everybody attending sees a different local time for it.
 *
 * Almost every bug in calendar software lives in the gap between those two,
 * and this file's job is to keep them apart. A date is never turned into a
 * timestamp, and a timestamp is never turned into a bare date.
 *
 * The spec also declines to support recurring events, on the grounds that
 * recurrence is where calendar complexity actually lives. Nothing here invents
 * it: a weekly meeting is a series of separate events, which is what the NIP
 * says to do.
 */

/** All-day or multi-day. Dates, not times. */
export const DATE_EVENT_KIND = 31922;
/** An instant to an instant. */
export const TIME_EVENT_KIND = 31923;
/** A collection of calendar events. */
export const CALENDAR_KIND = 31924;
/** An attendance response. */
export const RSVP_KIND = 31925;

export const CALENDAR_EVENT_KINDS = [DATE_EVENT_KIND, TIME_EVENT_KIND] as const;

export const SECONDS_IN_DAY = 86400;

export type RsvpStatus = 'accepted' | 'declined' | 'tentative';
export type FreeBusy = 'free' | 'busy';

export interface Participant {
  pubkey: string;
  relay?: string;
  /** Free text — "speaker", "host". The spec does not enumerate roles. */
  role?: string;
}

interface CommonFields {
  /** The `d` tag. With kind and author, this addresses the event. */
  slug: string;
  title: string;
  summary?: string;
  image?: string;
  /** Repeatable: an address, a room, a video call link. */
  locations: string[];
  geohash?: string;
  participants: Participant[];
  hashtags: string[];
  /** `r` tags — links to pages, documents, recordings. */
  references: string[];
  /** Calendars this event asks to be added to. */
  calendarRequests: string[];
  /** The description. */
  content: string;
  event: NostrEvent;
}

/**
 * A day on the calendar, kept as three numbers.
 *
 * Deliberately not a `Date`. `new Date('2026-01-01')` is parsed as UTC
 * midnight, so for any reader west of Greenwich it prints as December 31st —
 * a public holiday shown on the wrong day, which is the single most common
 * bug in calendar code. Holding the parts means the only way to render one is
 * to build a local date from them, which is always right.
 */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface DateBasedEvent extends CommonFields {
  kind: typeof DATE_EVENT_KIND;
  start: CalendarDate;
  /**
   * Exclusive, as the spec defines it, and stored exactly as published.
   * Anything that shows this to a person must subtract a day first — see
   * `lastDay`.
   */
  end?: CalendarDate;
}

export interface TimeBasedEvent extends CommonFields {
  kind: typeof TIME_EVENT_KIND;
  /** Unix seconds. */
  start: number;
  /** Unix seconds, exclusive. Absent means the event is instantaneous. */
  end?: number;
  /** IANA zone for the start, when the publisher named one. */
  startTzid?: string;
  /**
   * IANA zone for the end. The spec says this inherits from `start_tzid` when
   * omitted, and that inheritance is applied on read so nothing downstream has
   * to remember it.
   */
  endTzid?: string;
}

export type CalendarEvent = DateBasedEvent | TimeBasedEvent;

export interface Calendar {
  slug: string;
  title: string;
  content: string;
  /** Addresses of the calendar events it holds. */
  entries: string[];
  event: NostrEvent;
}

export interface Rsvp {
  slug: string;
  /** Address of the calendar event being answered. */
  address: string;
  /** A specific revision, when the responder pinned one. */
  eventId?: string;
  status: RsvpStatus;
  /** Absent for a declined RSVP, which the spec says carries no free/busy. */
  freeBusy?: FreeBusy;
  /** The calendar event's author, when tagged. */
  host?: string;
  note: string;
  event: NostrEvent;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([key]) => key === name)?.[1]?.trim() || undefined;
}

function tagValues(event: NostrEvent, name: string): string[] {
  return event.tags
    .filter(([key]) => key === name)
    .map(([, value]) => value?.trim() ?? '')
    .filter(Boolean);
}

/**
 * The title, falling back to the deprecated `name` tag.
 *
 * `name` is deprecated but events carrying it are already published and will
 * not be rewritten. Reading it costs one line; not reading it renders somebody
 * else's event as untitled.
 */
function readTitle(event: NostrEvent): string {
  return tagValue(event, 'title') ?? tagValue(event, 'name') ?? '';
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses `YYYY-MM-DD` without going anywhere near a timezone. */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  /**
   * Rejects the 31st of February and friends. Built in local time and read
   * back in local time, so the round-trip never crosses a zone boundary.
   */
  const probe = new Date(year, month - 1, day);

  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function formatCalendarDate(date: CalendarDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

/** A `Date` at local midnight, which is the only safe way to render one. */
export function toLocalDate(date: CalendarDate): Date {
  return new Date(date.year, date.month - 1, date.day);
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return (
    a.year - b.year || a.month - b.month || a.day - b.day
  );
}

function shiftDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(date.year, date.month - 1, date.day + days);

  return {
    year: shifted.getFullYear(),
    month: shifted.getMonth() + 1,
    day: shifted.getDate(),
  };
}

/**
 * The last day a date-based event actually covers.
 *
 * The `end` tag is exclusive, so an event with `start` 2026-01-01 and `end`
 * 2026-01-03 runs on the 1st and the 2nd. Showing "Jan 1 – Jan 3" would add a
 * day that is not part of it, and this is the function that stops that from
 * happening anywhere.
 *
 * An `end` at or before `start` is treated as absent. The spec requires start
 * to be less than end, and an event that ends before it begins is more likely
 * a publisher's off-by-one than an instruction to show nothing.
 */
export function lastDay(event: DateBasedEvent): CalendarDate {
  if (!event.end) return event.start;
  if (compareDates(event.end, event.start) <= 0) return event.start;

  return shiftDays(event.end, -1);
}

/**
 * The `D` day-index tags for a time-based event.
 *
 * `floor(unix_seconds / 86400)`, one per day the event touches, so a relay can
 * answer "what is on this day" with a tag filter instead of handing over every
 * event ever published for the client to sift.
 *
 * The end is exclusive, so an event ending exactly at midnight covers the day
 * before and not the one starting at that instant — computing the index off
 * `end` directly would tag a day the event has already finished on.
 */
export function dayIndexes(start: number, end?: number): string[] {
  const first = Math.floor(start / SECONDS_IN_DAY);

  if (end === undefined || end <= start) return [String(first)];

  const last = Math.floor((end - 1) / SECONDS_IN_DAY);

  /**
   * Bounded. A publisher can write any end they like, including one a century
   * out, and a tag per day would be a megabyte of event that no relay accepts.
   */
  const days: string[] = [];
  for (let index = first; index <= last && days.length < 366; index += 1) {
    days.push(String(index));
  }

  return days;
}

/** The day index for a moment, matching what `D` tags hold. */
export function dayIndexOf(seconds: number): number {
  return Math.floor(seconds / SECONDS_IN_DAY);
}

function readParticipants(event: NostrEvent): Participant[] {
  const found: Participant[] = [];
  const seen = new Set<string>();

  for (const [name, pubkey, relay, role] of event.tags) {
    if (name !== 'p') continue;
    if (!/^[0-9a-f]{64}$/i.test(pubkey ?? '')) continue;

    const key = pubkey.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    found.push({
      pubkey: key,
      relay: relay?.trim() || undefined,
      role: role?.trim() || undefined,
    });
  }

  return found;
}

function readCommon(event: NostrEvent): CommonFields | null {
  const slug = tagValue(event, 'd');
  const title = readTitle(event);

  // Both are required, and an event missing either cannot be addressed or shown
  if (!slug || !title) return null;

  return {
    slug,
    title,
    summary: tagValue(event, 'summary'),
    image: tagValue(event, 'image'),
    locations: tagValues(event, 'location'),
    geohash: tagValue(event, 'g'),
    participants: readParticipants(event),
    hashtags: tagValues(event, 't').map((tag) => tag.toLowerCase()),
    references: tagValues(event, 'r'),
    calendarRequests: tagValues(event, 'a').filter((address) =>
      address.startsWith(`${CALENDAR_KIND}:`)
    ),
    content: event.content,
    event,
  };
}

/**
 * Reads a calendar event, or null when it is not one.
 *
 * Strict about `start` because everything downstream sorts and groups by it —
 * an event with an unparseable start has no place on a calendar, and putting
 * it at the epoch would file it under 1970 rather than admitting it is broken.
 */
export function parseCalendarEvent(event: NostrEvent): CalendarEvent | null {
  const common = readCommon(event);
  if (!common) return null;

  const rawStart = tagValue(event, 'start');
  if (!rawStart) return null;

  if (event.kind === DATE_EVENT_KIND) {
    const start = parseCalendarDate(rawStart);
    if (!start) return null;

    const rawEnd = tagValue(event, 'end');
    const end = rawEnd ? parseCalendarDate(rawEnd) : null;

    return { ...common, kind: DATE_EVENT_KIND, start, end: end ?? undefined };
  }

  if (event.kind === TIME_EVENT_KIND) {
    const start = Number.parseInt(rawStart, 10);
    if (!Number.isFinite(start) || start <= 0) return null;

    const rawEnd = tagValue(event, 'end');
    const parsedEnd = rawEnd ? Number.parseInt(rawEnd, 10) : NaN;

    /**
     * An end at or before the start is dropped rather than kept. The spec
     * requires end to be greater, and a negative duration would render as
     * "18:00 – 17:00" or produce a day range that counts backwards.
     */
    const end =
      Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : undefined;

    const startTzid = tagValue(event, 'start_tzid');

    return {
      ...common,
      kind: TIME_EVENT_KIND,
      start,
      end,
      startTzid,
      // Inheritance is the spec's, applied here so nothing downstream repeats it
      endTzid: tagValue(event, 'end_tzid') ?? startTzid,
    };
  }

  return null;
}

export function isDateBased(event: CalendarEvent): event is DateBasedEvent {
  return event.kind === DATE_EVENT_KIND;
}

/** Reads a kind 31924 calendar. */
export function parseCalendar(event: NostrEvent): Calendar | null {
  if (event.kind !== CALENDAR_KIND) return null;

  const slug = tagValue(event, 'd');
  const title = readTitle(event);
  if (!slug || !title) return null;

  return {
    slug,
    title,
    content: event.content,
    entries: tagValues(event, 'a').filter((address) =>
      CALENDAR_EVENT_KINDS.some((kind) => address.startsWith(`${kind}:`))
    ),
    event,
  };
}

const RSVP_STATUSES = new Set<string>(['accepted', 'declined', 'tentative']);

/** Reads a kind 31925 RSVP. */
export function parseRsvp(event: NostrEvent): Rsvp | null {
  if (event.kind !== RSVP_KIND) return null;

  const slug = tagValue(event, 'd');
  const status = tagValue(event, 'status')?.toLowerCase();

  const address = event.tags
    .filter(([name]) => name === 'a')
    .map(([, value]) => value?.trim() ?? '')
    .find((value) =>
      CALENDAR_EVENT_KINDS.some((kind) => value.startsWith(`${kind}:`))
    );

  // All three are required, and an RSVP missing any of them answers nothing
  if (!slug || !address || !status || !RSVP_STATUSES.has(status)) return null;

  const rawFreeBusy = tagValue(event, 'fb')?.toLowerCase();

  /**
   * "This tag must be omitted or ignored if the status label is set to
   * declined." Ignored on read as well as omitted on write, because the
   * instruction is about readers too — somebody who declines is not busy for
   * the duration of an event they are not attending.
   */
  const freeBusy =
    status !== 'declined' && (rawFreeBusy === 'free' || rawFreeBusy === 'busy')
      ? (rawFreeBusy as FreeBusy)
      : undefined;

  return {
    slug,
    address,
    eventId: tagValue(event, 'e'),
    status: status as RsvpStatus,
    freeBusy,
    host: tagValue(event, 'p'),
    note: event.content,
    event,
  };
}

/** The `kind:pubkey:d` address of a calendar event, calendar or RSVP. */
export function addressOfEvent(event: NostrEvent): string | null {
  const slug = tagValue(event, 'd');
  if (!slug) return null;

  return `${event.kind}:${event.pubkey}:${slug}`;
}

export interface CalendarEventInput {
  slug: string;
  title: string;
  summary?: string;
  image?: string;
  content?: string;
  locations?: string[];
  geohash?: string;
  participants?: Participant[];
  hashtags?: string[];
  references?: string[];
  /** Calendars to ask for inclusion in. */
  calendars?: string[];
}

export interface DateEventInput extends CalendarEventInput {
  start: CalendarDate;
  /** The last day the event covers, inclusive — not the exclusive `end` tag. */
  through?: CalendarDate;
}

export interface TimeEventInput extends CalendarEventInput {
  start: number;
  end?: number;
  startTzid?: string;
  endTzid?: string;
}

function commonTags(input: CalendarEventInput): string[][] {
  const tags: string[][] = [
    ['d', input.slug],
    ['title', input.title],
  ];

  if (input.summary?.trim()) tags.push(['summary', input.summary.trim()]);
  if (input.image?.trim()) tags.push(['image', input.image.trim()]);

  for (const location of input.locations ?? []) {
    if (location.trim()) tags.push(['location', location.trim()]);
  }

  if (input.geohash?.trim()) tags.push(['g', input.geohash.trim()]);

  for (const participant of input.participants ?? []) {
    tags.push([
      'p',
      participant.pubkey,
      participant.relay ?? '',
      participant.role ?? '',
    ]);
  }

  for (const hashtag of input.hashtags ?? []) {
    const cleaned = hashtag.trim().replace(/^#/, '').toLowerCase();
    if (cleaned) tags.push(['t', cleaned]);
  }

  for (const reference of input.references ?? []) {
    if (reference.trim()) tags.push(['r', reference.trim()]);
  }

  /**
   * Asking to be added to somebody else's calendar. The event carries the
   * request; whether it is granted is the calendar owner's `a` tag pointing
   * back, which is not this event's to write.
   */
  for (const calendar of input.calendars ?? []) {
    if (calendar.startsWith(`${CALENDAR_KIND}:`)) tags.push(['a', calendar]);
  }

  return tags;
}

/**
 * Tags for a date-based calendar event.
 *
 * Takes the last covered day and writes the exclusive `end` the spec wants, so
 * the conversion happens once here rather than at every call site — a UI that
 * asked the publisher for an exclusive end date would be asking them to think
 * in a convention no calendar app has ever shown them.
 */
export function dateEventTags(input: DateEventInput): string[][] {
  const tags = commonTags(input);

  tags.push(['start', formatCalendarDate(input.start)]);

  if (input.through && compareDates(input.through, input.start) > 0) {
    tags.push(['end', formatCalendarDate(shiftDays(input.through, 1))]);
  }

  return tags;
}

/** Tags for a time-based calendar event, including the `D` day index. */
export function timeEventTags(input: TimeEventInput): string[][] {
  const tags = commonTags(input);

  tags.push(['start', String(Math.floor(input.start))]);

  const end =
    input.end !== undefined && input.end > input.start
      ? Math.floor(input.end)
      : undefined;

  if (end !== undefined) tags.push(['end', String(end)]);

  if (input.startTzid?.trim()) {
    tags.push(['start_tzid', input.startTzid.trim()]);
  }

  /**
   * Written only when it differs from the start zone. The spec makes the end
   * inherit, so repeating the same value is noise — and an event that crosses
   * a zone is rare enough that saying so explicitly is the informative case.
   */
  const endTzid = input.endTzid?.trim();
  if (endTzid && endTzid !== input.startTzid?.trim()) {
    tags.push(['end_tzid', endTzid]);
  }

  for (const index of dayIndexes(input.start, end)) {
    tags.push(['D', index]);
  }

  return tags;
}

export interface CalendarInput {
  slug: string;
  title: string;
  content?: string;
  entries?: string[];
}

export function calendarTags(input: CalendarInput): string[][] {
  const tags: string[][] = [
    ['d', input.slug],
    ['title', input.title],
  ];

  for (const address of input.entries ?? []) {
    if (CALENDAR_EVENT_KINDS.some((kind) => address.startsWith(`${kind}:`))) {
      tags.push(['a', address]);
    }
  }

  return tags;
}

export interface RsvpInput {
  /** Address of the calendar event being answered. */
  address: string;
  status: RsvpStatus;
  freeBusy?: FreeBusy;
  /** The revision answered, when pinning one. */
  eventId?: string;
  /** The calendar event's author. */
  host?: string;
  slug?: string;
}

/**
 * A stable `d` for an RSVP.
 *
 * The spec says "universally unique identifier", and a fresh random string
 * satisfies that — but an RSVP is addressable, so a new identifier every time
 * means changing your answer publishes a *second* RSVP rather than replacing
 * the first. A guest list would then show the same person as both accepted and
 * declined, with no rule saying which wins.
 *
 * Deriving it from the calendar event's address keeps it unique per person per
 * event, which is the uniqueness that matters, and makes "I can't make it
 * after all" replace the earlier yes.
 */
export function rsvpSlug(address: string): string {
  return `rsvp:${address}`;
}

export function rsvpTags(input: RsvpInput): string[][] {
  const tags: string[][] = [
    ['d', input.slug ?? rsvpSlug(input.address)],
    ['a', input.address],
    ['status', input.status],
  ];

  if (input.eventId) tags.push(['e', input.eventId]);

  // Declining says nothing about availability, so no `fb` is written for it
  if (input.freeBusy && input.status !== 'declined') {
    tags.push(['fb', input.freeBusy]);
  }

  if (input.host) tags.push(['p', input.host]);

  return tags;
}

/**
 * When a calendar event begins, as a moment.
 *
 * A date-based event has no moment of its own, so local midnight stands in.
 * That is a rendering decision, not a fact about the event, and it is confined
 * to sorting and "is this over" — the two places a common ordering is needed
 * across both kinds.
 */
export function startsAt(event: CalendarEvent): number {
  if (isDateBased(event)) return toLocalDate(event.start).getTime() / 1000;
  return event.start;
}

/** When it finishes, for the same purposes. */
export function endsAt(event: CalendarEvent): number {
  if (isDateBased(event)) {
    // Through the end of the last covered day, since a date has no clock time
    const end = toLocalDate(lastDay(event));
    end.setHours(23, 59, 59);
    return end.getTime() / 1000;
  }

  return event.end ?? event.start;
}

export function hasPassed(event: CalendarEvent, now = Date.now() / 1000): boolean {
  return endsAt(event) < now;
}

/** Upcoming first, then by start. Past events sort after, most recent first. */
export function byUpcoming(a: CalendarEvent, b: CalendarEvent): number {
  const now = Date.now() / 1000;
  const aPast = hasPassed(a, now);
  const bPast = hasPassed(b, now);

  if (aPast !== bPast) return aPast ? 1 : -1;
  return aPast ? startsAt(b) - startsAt(a) : startsAt(a) - startsAt(b);
}

/**
 * The latest RSVP per person.
 *
 * Necessary even with a derived `d`, because other clients generate random
 * ones and a person who answered through two of them has two live RSVPs. The
 * most recent is taken as their answer, which is the only reading that lets
 * somebody change their mind.
 */
export function latestRsvps(rsvps: Rsvp[]): Map<string, Rsvp> {
  const byAuthor = new Map<string, Rsvp>();

  for (const rsvp of rsvps) {
    const existing = byAuthor.get(rsvp.event.pubkey);

    if (!existing || rsvp.event.created_at > existing.event.created_at) {
      byAuthor.set(rsvp.event.pubkey, rsvp);
    }
  }

  return byAuthor;
}

export interface RsvpTally {
  accepted: number;
  declined: number;
  tentative: number;
}

export function tallyRsvps(rsvps: Rsvp[]): RsvpTally {
  const tally: RsvpTally = { accepted: 0, declined: 0, tentative: 0 };

  for (const rsvp of latestRsvps(rsvps).values()) {
    tally[rsvp.status] += 1;
  }

  return tally;
}

/**
 * How a date-based event reads to a person.
 *
 * Built from the local-midnight `Date`, so the month name and weekday are the
 * reader's own — and always the day the publisher wrote, never one either side
 * of it.
 */
export function formatDateRange(event: DateBasedEvent): string {
  const from = toLocalDate(event.start);
  const through = toLocalDate(lastDay(event));

  const sameDay = from.getTime() === through.getTime();

  const long: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };

  if (sameDay) return from.toLocaleDateString(undefined, long);

  const sameYear = from.getFullYear() === through.getFullYear();
  const sameMonth = sameYear && from.getMonth() === through.getMonth();

  const start = from.toLocaleDateString(undefined, {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
    ...(sameYear ? {} : { year: 'numeric' }),
  });

  return `${start} – ${through.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

/**
 * Whether an event's own timezone is worth naming.
 *
 * Times are shown in the reader's zone, which is what they need. Naming the
 * publisher's zone as well only helps when the two differ — otherwise it is
 * clutter that says "09:00 (your time, which is also their time)".
 */
export function foreignZone(event: TimeBasedEvent): string | undefined {
  if (!event.startTzid) return undefined;

  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return event.startTzid === here ? undefined : event.startTzid;
}

/** The clock time in a named zone, for showing a host's local time. */
export function timeInZone(seconds: number, timeZone: string): string | null {
  try {
    return new Date(seconds * 1000).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    });
  } catch {
    /**
     * An unrecognised IANA identifier throws rather than falling back, and a
     * publisher can write anything into the tag. Returning null lets the
     * caller drop the line instead of rendering "Invalid Date".
     */
    return null;
  }
}

/** How a time-based event reads: date, then clock, in the reader's zone. */
export function formatTimeRange(event: TimeBasedEvent): string {
  const from = new Date(event.start * 1000);

  const date = from.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const startTime = from.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  // An instantaneous event, which the spec allows when `end` is omitted
  if (event.end === undefined) return `${date}, ${startTime}`;

  const to = new Date(event.end * 1000);
  const endTime = to.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  const sameDay = from.toDateString() === to.toDateString();
  if (sameDay) return `${date}, ${startTime} – ${endTime}`;

  const endDate = to.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return `${date}, ${startTime} – ${endDate}, ${endTime}`;
}

/** One line describing when an event happens, whichever kind it is. */
export function formatWhen(event: CalendarEvent): string {
  return isDateBased(event) ? formatDateRange(event) : formatTimeRange(event);
}
