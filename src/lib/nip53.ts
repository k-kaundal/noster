import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-53 live activities.
 *
 * A stream on Nostr is not a video this app serves. It is an addressable event
 * describing one — who is hosting, whether it has started, and a URL the video
 * actually comes from — republished by the host as things change. The video
 * itself lives wherever the host put it, which is why `streaming` is a URL to
 * hand a player rather than anything this app produces.
 *
 * That distinction is the whole reason the page can exist without any
 * infrastructure behind it: hosting a stream is somebody else's problem, and
 * announcing one is a Nostr event like any other.
 */

/** NIP-53 live event. Addressable, so the newest per host and `d` wins. */
export const LIVE_EVENT_KIND = 30311;

/** NIP-53 live chat message, addressed to a live event with `a`. */
export const LIVE_CHAT_KIND = 1311;

export type LiveStatus = 'planned' | 'live' | 'ended';

/**
 * How long after its start a `live` event is still believed.
 *
 * Hosts are supposed to republish with `status: ended` when they stop, and
 * plenty never do — the tab is closed, the software crashes, the stream just
 * stops. Without a cutoff the "Live now" shelf fills with streams that ended
 * months ago, which is worse than an empty shelf: it is a page of dead links
 * that all look current.
 */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export interface LiveParticipant {
  pubkey: string;
  /** `Host`, `Speaker`, `Participant` — free text in the spec. */
  role: string;
  relay?: string;
}

export interface LiveEvent {
  event: NostrEvent;
  /** `30311:<pubkey>:<d>`, which chat messages address with `a`. */
  address: string;
  identifier: string;
  /** Whoever published it. Not necessarily the person tagged as Host. */
  author: string;
  title: string;
  summary?: string;
  image?: string;
  /** The URL a player is given. Absent for a stream that has not started. */
  streaming?: string;
  /** Where to watch it back, once there is one. */
  recording?: string;
  status: LiveStatus;
  starts?: number;
  ends?: number;
  currentParticipants?: number;
  totalParticipants?: number;
  participants: LiveParticipant[];
  hashtags: string[];
}

const tagValue = (event: NostrEvent, name: string): string | undefined =>
  event.tags.find(([tagName]) => tagName === name)?.[1] || undefined;

function readNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readStatus(value: string | undefined): LiveStatus {
  if (value === 'live' || value === 'ended' || value === 'planned') return value;

  /*
   * Anything else is treated as planned rather than live. A stream that has
   * not started shown as upcoming is a small disappointment; a dead one shown
   * as live is a broken player and a reader who concludes the feature does not
   * work.
   */
  return 'planned';
}

/** Reads a kind 30311, or null when it is not one worth showing. */
export function parseLiveEvent(event: NostrEvent): LiveEvent | null {
  if (event.kind !== LIVE_EVENT_KIND) return null;

  const identifier = tagValue(event, 'd');
  const title = tagValue(event, 'title');

  // Both are what makes it addressable and nameable; without either there is
  // nothing to link to and nothing to call it
  if (!identifier || !title) return null;

  const participants: LiveParticipant[] = event.tags
    .filter(([name, pubkey]) => name === 'p' && !!pubkey)
    .map(([, pubkey, relay, role]) => ({
      pubkey,
      role: role || 'Participant',
      relay: relay || undefined,
    }));

  return {
    event,
    address: `${LIVE_EVENT_KIND}:${event.pubkey}:${identifier}`,
    identifier,
    author: event.pubkey,
    title,
    summary: tagValue(event, 'summary'),
    image: tagValue(event, 'image'),
    streaming: tagValue(event, 'streaming'),
    recording: tagValue(event, 'recording'),
    status: readStatus(tagValue(event, 'status')),
    starts: readNumber(tagValue(event, 'starts')),
    ends: readNumber(tagValue(event, 'ends')),
    currentParticipants: readNumber(tagValue(event, 'current_participants')),
    totalParticipants: readNumber(tagValue(event, 'total_participants')),
    participants,
    hashtags: event.tags
      .filter(([name, value]) => name === 't' && !!value)
      .map(([, value]) => value.toLowerCase()),
  };
}

/** Whoever is running it: the first `Host` tag, falling back to the author. */
export function hostOf(live: LiveEvent): string {
  const host = live.participants.find(
    (person) => person.role.toLowerCase() === 'host'
  );

  return host?.pubkey ?? live.author;
}

/**
 * The status to actually show, which is not always the one claimed.
 *
 * A `live` event nobody has touched in half a day is treated as ended. See
 * `STALE_AFTER_MS` — hosts who stop without republishing are the common case,
 * not the exception.
 */
export function effectiveStatus(live: LiveEvent, now = Date.now()): LiveStatus {
  if (live.status !== 'live') return live.status;

  const touched = Math.max(live.event.created_at, live.starts ?? 0) * 1000;

  return now - touched > STALE_AFTER_MS ? 'ended' : 'live';
}

/** Whether a stream can be watched right now. */
export function isWatchable(live: LiveEvent, now = Date.now()): boolean {
  return effectiveStatus(live, now) === 'live' && !!live.streaming;
}

/**
 * The newest revision of each activity.
 *
 * Addressable, so a host republishing to change the status produces another
 * event at the same address — and relays disagree about which they hold, so
 * the same stream arrives several times, often with different statuses.
 */
export function newestLiveEvents(events: readonly NostrEvent[]): LiveEvent[] {
  const byAddress = new Map<string, LiveEvent>();

  for (const event of events) {
    const live = parseLiveEvent(event);
    if (!live) continue;

    const held = byAddress.get(live.address);
    if (!held || live.event.created_at > held.event.created_at) {
      byAddress.set(live.address, live);
    }
  }

  return [...byAddress.values()];
}

export interface LiveShelves {
  live: LiveEvent[];
  upcoming: LiveEvent[];
  past: LiveEvent[];
}

/**
 * Sorted into what somebody opening the page is looking for.
 *
 * Live first and busiest first, because a stream with people in it is the one
 * worth joining. Upcoming by when they start, soonest first — a schedule read
 * backwards is not a schedule. Past by most recent.
 */
export function shelveLiveEvents(
  events: readonly LiveEvent[],
  now = Date.now()
): LiveShelves {
  const shelves: LiveShelves = { live: [], upcoming: [], past: [] };

  for (const live of events) {
    const status = effectiveStatus(live, now);

    if (status === 'live') shelves.live.push(live);
    else if (status === 'planned') shelves.upcoming.push(live);
    else shelves.past.push(live);
  }

  shelves.live.sort(
    (a, b) => (b.currentParticipants ?? 0) - (a.currentParticipants ?? 0)
  );

  shelves.upcoming.sort(
    (a, b) => (a.starts ?? Infinity) - (b.starts ?? Infinity)
  );

  shelves.past.sort(
    (a, b) =>
      (b.ends ?? b.event.created_at) - (a.ends ?? a.event.created_at)
  );

  return shelves;
}

/** The `a` tag a chat message on this activity carries. */
export function liveChatFilter(address: string) {
  return { kinds: [LIVE_CHAT_KIND], '#a': [address], limit: 200 };
}
