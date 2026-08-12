import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMuteList } from '@/hooks/useMuteList';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { filterMuted } from '@/lib/mute';
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_KIND,
  DATE_EVENT_KIND,
  RSVP_KIND,
  TIME_EVENT_KIND,
  byUpcoming,
  calendarTags,
  dateEventTags,
  hasPassed,
  parseCalendar,
  parseCalendarEvent,
  parseRsvp,
  rsvpSlug,
  rsvpTags,
  timeEventTags,
  type Calendar,
  type CalendarEvent,
  type DateEventInput,
  type Rsvp,
  type RsvpInput,
  type TimeEventInput,
} from '@/lib/nip52';

/**
 * One revision per address.
 *
 * Addressable events are replaced rather than superseded, but relays hold
 * older revisions and hand several back. For a calendar event the difference
 * is the time it starts, so showing a stale revision sends somebody to a
 * meeting that moved.
 */
function latestPerAddress(events: NostrEvent[]): CalendarEvent[] {
  const byAddress = new Map<string, CalendarEvent>();

  for (const event of events) {
    const parsed = parseCalendarEvent(event);
    if (!parsed) continue;

    const address = `${event.kind}:${event.pubkey}:${parsed.slug}`;
    const existing = byAddress.get(address);

    if (!existing || existing.event.created_at < event.created_at) {
      byAddress.set(address, parsed);
    }
  }

  return [...byAddress.values()];
}

interface CalendarEventQuery {
  author?: string;
  hashtag?: string;
  /** Events that have already finished. Off by default. */
  includePast?: boolean;
  /**
   * Narrow to a single day, using the `D` index a time-based event carries.
   *
   * Only time-based events can be filtered this way — date-based ones have no
   * `D` tag to match, which is why a day view still has to read both kinds and
   * sift the date-based half locally.
   */
  day?: number;
  limit?: number;
}

export function useCalendarEvents({
  author,
  hashtag,
  includePast = false,
  day,
  limit = 100,
}: CalendarEventQuery = {}) {
  const { nostr } = useNostr();
  const { list: muteList } = useMuteList();

  const query = useQuery({
    queryKey: [
      'calendar-events',
      author ?? '',
      hashtag ?? '',
      includePast,
      day ?? '',
      limit,
    ],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(6000)]);

      /**
       * Both kinds in one filter. They are the same thing to a reader looking
       * at a calendar, and splitting them into two queries would double the
       * relay round trips to assemble one list.
       */
      const events = await nostr.query(
        [
          {
            kinds: [...CALENDAR_EVENT_KINDS],
            ...(author ? { authors: [author] } : {}),
            ...(hashtag ? { '#t': [hashtag.toLowerCase()] } : {}),
            ...(day !== undefined ? { '#D': [String(day)] } : {}),
            limit,
          },
        ],
        { signal }
      );

      const parsed = latestPerAddress(filterMuted(events, muteList));

      const visible = includePast
        ? parsed
        : parsed.filter((entry) => !hasPassed(entry));

      return visible.sort(byUpcoming);
    },
  });

  return {
    events: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/** One calendar event by address. */
export function useCalendarEvent(
  pubkey: string | undefined,
  slug: string | undefined,
  kind: number = TIME_EVENT_KIND
) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['calendar-event', kind, pubkey ?? '', slug ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [{ kinds: [kind], authors: [pubkey!], '#d': [slug!], limit: 5 }],
        { signal }
      );

      return latestPerAddress(events)[0] ?? null;
    },
    enabled: !!pubkey && !!slug,
  });

  return {
    calendarEvent: query.data ?? null,
    isLoading: query.isLoading,
  };
}

/** Calendars — kind 31924 collections. */
export function useCalendars(author?: string) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['calendars', author ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [
          {
            kinds: [CALENDAR_KIND],
            ...(author ? { authors: [author] } : {}),
            limit: 50,
          },
        ],
        { signal }
      );

      const byAddress = new Map<string, Calendar>();

      for (const event of events) {
        const calendar = parseCalendar(event);
        if (!calendar) continue;

        const address = `${CALENDAR_KIND}:${event.pubkey}:${calendar.slug}`;
        const existing = byAddress.get(address);

        if (!existing || existing.event.created_at < event.created_at) {
          byAddress.set(address, calendar);
        }
      }

      return [...byAddress.values()];
    },
  });

  return {
    calendars: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/**
 * The RSVPs for one calendar event.
 *
 * Queried by the event's address rather than its id, because the address
 * survives the host editing the event. An RSVP may additionally pin a
 * revision with an `e` tag — that is kept when reading, so a UI can tell that
 * somebody agreed to an earlier version, but it does not exclude them from
 * the list.
 */
export function useRsvps(address: string | undefined) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['rsvps', address ?? ''],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query(
        [{ kinds: [RSVP_KIND], '#a': [address!], limit: 300 }],
        { signal }
      );

      const parsed: Rsvp[] = [];
      for (const event of events) {
        const rsvp = parseRsvp(event);

        /**
         * The address is re-checked rather than trusted from the filter. An
         * RSVP can carry several `a` tags, and a relay matching any one of
         * them would otherwise file somebody's answer under the wrong event.
         */
        if (rsvp && rsvp.address === address) parsed.push(rsvp);
      }

      return parsed;
    },
    enabled: !!address,
  });

  return {
    rsvps: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/** Publishing an RSVP. */
export function useRsvp() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: RsvpInput & { note?: string }) => {
      if (!user) throw new Error('You must be logged in to RSVP');

      await createEvent({
        kind: RSVP_KIND,
        content: input.note?.trim() ?? '',
        tags: rsvpTags({ ...input, slug: input.slug ?? rsvpSlug(input.address) }),
      });

      return input.address;
    },
    onSuccess: (address) => {
      queryClient.invalidateQueries({ queryKey: ['rsvps', address] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not RSVP',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    rsvp: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/** Publishing a calendar event. */
export function usePublishCalendarEvent() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (
      input:
        | { kind: typeof DATE_EVENT_KIND; event: DateEventInput }
        | { kind: typeof TIME_EVENT_KIND; event: TimeEventInput }
    ) => {
      if (!user) throw new Error('You must be logged in to publish an event');

      const tags =
        input.kind === DATE_EVENT_KIND
          ? dateEventTags(input.event)
          : timeEventTags(input.event);

      await createEvent({
        kind: input.kind,
        content: input.event.content ?? '',
        tags,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      toast({ title: 'Event published' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not publish',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    publish: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/**
 * Adding an event to one of your own calendars.
 *
 * A calendar is a replaceable list, so this republishes the whole thing with
 * one more `a` tag. Reading the current entries first is not optional: writing
 * a calendar from just the new address would silently empty it.
 */
export function useCalendarInclusion() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: { calendar: Calendar; address: string }) => {
      if (!user) throw new Error('You must be logged in');
      if (input.calendar.event.pubkey !== user.pubkey) {
        throw new Error('That calendar is not yours');
      }

      if (input.calendar.entries.includes(input.address)) return;

      await createEvent({
        kind: CALENDAR_KIND,
        content: input.calendar.content,
        tags: calendarTags({
          slug: input.calendar.slug,
          title: input.calendar.title,
          entries: [...input.calendar.entries, input.address],
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      toast({ title: 'Added to your calendar' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not add it',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    include: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

/** Creating a calendar to file events under. */
export function useCreateCalendar() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: { title: string; description?: string }) => {
      if (!user) throw new Error('You must be logged in');

      const title = input.title.trim();
      if (!title) throw new Error('Give the calendar a name');

      await createEvent({
        kind: CALENDAR_KIND,
        content: input.description?.trim() ?? '',
        tags: calendarTags({ slug: crypto.randomUUID(), title }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      toast({ title: 'Calendar created' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not create it',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    createCalendar: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}
