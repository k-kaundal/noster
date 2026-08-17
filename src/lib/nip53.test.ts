import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  LIVE_EVENT_KIND,
  STALE_AFTER_MS,
  effectiveStatus,
  hostOf,
  isWatchable,
  liveChatFilter,
  newestLiveEvents,
  parseLiveEvent,
  shelveLiveEvents,
} from './nip53';

const NOW = 1_700_000_000_000;
const seconds = NOW / 1000;

function live(tags: string[][] = [], over: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    kind: LIVE_EVENT_KIND,
    pubkey: 'host'.padEnd(64, '0'),
    created_at: seconds,
    content: '',
    tags: [['d', 'stream-1'], ['title', 'Building on Nostr'], ...tags],
    sig: '',
    ...over,
  };
}

describe('parseLiveEvent', () => {
  it('reads an activity', () => {
    const parsed = parseLiveEvent(
      live([
        ['summary', 'A walkthrough.'],
        ['image', 'https://example.com/cover.png'],
        ['streaming', 'https://example.com/stream.m3u8'],
        ['status', 'live'],
        ['starts', String(seconds - 600)],
        ['current_participants', '42'],
        ['t', 'Nostr'],
      ])
    );

    expect(parsed?.title).toBe('Building on Nostr');
    expect(parsed?.streaming).toBe('https://example.com/stream.m3u8');
    expect(parsed?.status).toBe('live');
    expect(parsed?.currentParticipants).toBe(42);
    expect(parsed?.hashtags).toEqual(['nostr']);
  });

  it('builds the address chat messages point at', () => {
    const parsed = parseLiveEvent(live());
    expect(parsed?.address).toBe(`${LIVE_EVENT_KIND}:${'host'.padEnd(64, '0')}:stream-1`);
  });

  it('declines anything that is not a live activity', () => {
    expect(parseLiveEvent(live([], { kind: 1 }))).toBeNull();
  });

  it('declines one with no identifier or no title', () => {
    // Without a `d` there is nothing to link to; without a title, nothing to
    // call it on a card
    const noId = { ...live(), tags: [['title', 'x']] };
    const noTitle = { ...live(), tags: [['d', 'x']] };

    expect(parseLiveEvent(noId)).toBeNull();
    expect(parseLiveEvent(noTitle)).toBeNull();
  });

  it('treats an unknown status as planned, never as live', () => {
    /*
     * A stream shown as upcoming when it has not started is a small
     * disappointment. A dead one shown as live is a broken player and a reader
     * who concludes the feature does not work.
     */
    expect(parseLiveEvent(live([['status', 'nonsense']]))?.status).toBe('planned');
    expect(parseLiveEvent(live())?.status).toBe('planned');
  });

  it('ignores a participant count that is not a number', () => {
    const parsed = parseLiveEvent(live([['current_participants', 'lots']]));
    expect(parsed?.currentParticipants).toBeUndefined();
  });

  it('reads participants and their roles', () => {
    const parsed = parseLiveEvent(
      live([
        ['p', 'alice', 'wss://a.example', 'Host'],
        ['p', 'bob', '', 'Speaker'],
        ['p', 'carol'],
      ])
    );

    expect(parsed?.participants).toEqual([
      { pubkey: 'alice', role: 'Host', relay: 'wss://a.example' },
      { pubkey: 'bob', role: 'Speaker', relay: undefined },
      { pubkey: 'carol', role: 'Participant', relay: undefined },
    ]);
  });
});

describe('hostOf', () => {
  it('prefers the tagged host', () => {
    const parsed = parseLiveEvent(live([['p', 'alice', '', 'Host']]))!;
    expect(hostOf(parsed)).toBe('alice');
  });

  it('matches the role however it was cased', () => {
    const parsed = parseLiveEvent(live([['p', 'alice', '', 'host']]))!;
    expect(hostOf(parsed)).toBe('alice');
  });

  it('falls back to whoever published it', () => {
    const parsed = parseLiveEvent(live())!;
    expect(hostOf(parsed)).toBe('host'.padEnd(64, '0'));
  });
});

describe('effectiveStatus', () => {
  it('believes a stream that was just published', () => {
    const parsed = parseLiveEvent(live([['status', 'live']]))!;
    expect(effectiveStatus(parsed, NOW)).toBe('live');
  });

  it('treats a long-untouched live stream as ended', () => {
    /*
     * Hosts who stop without republishing are the common case, not the
     * exception. Without this the shelf fills with streams that ended months
     * ago — a page of dead links that all look current, which is worse than
     * an empty page.
     */
    const stale = parseLiveEvent(
      live([['status', 'live']], { created_at: seconds - STALE_AFTER_MS / 1000 - 60 })
    )!;

    expect(effectiveStatus(stale, NOW)).toBe('ended');
  });

  it('keeps a stale event alive if it says it started recently', () => {
    const parsed = parseLiveEvent(
      live([['status', 'live'], ['starts', String(seconds - 60)]], {
        created_at: seconds - STALE_AFTER_MS / 1000 - 600,
      })
    )!;

    expect(effectiveStatus(parsed, NOW)).toBe('live');
  });

  it('leaves planned and ended alone however old they are', () => {
    const old = { created_at: 1 };
    expect(effectiveStatus(parseLiveEvent(live([['status', 'planned']], old))!, NOW)).toBe('planned');
    expect(effectiveStatus(parseLiveEvent(live([['status', 'ended']], old))!, NOW)).toBe('ended');
  });
});

describe('isWatchable', () => {
  it('needs both a live status and somewhere to watch', () => {
    const withUrl = parseLiveEvent(
      live([['status', 'live'], ['streaming', 'https://example.com/s.m3u8']])
    )!;
    const withoutUrl = parseLiveEvent(live([['status', 'live']]))!;

    expect(isWatchable(withUrl, NOW)).toBe(true);
    expect(isWatchable(withoutUrl, NOW)).toBe(false);
  });
});

describe('newestLiveEvents', () => {
  it('keeps the newest revision of one activity', () => {
    // A host republishes to change the status, and relays disagree about
    // which revision they hold
    const events = [
      live([['status', 'planned']], { id: 'old', created_at: 100 }),
      live([['status', 'live']], { id: 'new', created_at: 200 }),
    ];

    const kept = newestLiveEvents(events);

    expect(kept).toHaveLength(1);
    expect(kept[0].status).toBe('live');
  });

  it('keeps different activities apart', () => {
    const other = { ...live(), tags: [['d', 'stream-2'], ['title', 'Other']] };
    expect(newestLiveEvents([live(), other])).toHaveLength(2);
  });

  it('drops anything unparseable rather than rendering a blank card', () => {
    expect(newestLiveEvents([live([], { kind: 1 }), { ...live(), tags: [] }])).toEqual([]);
  });
});

describe('shelveLiveEvents', () => {
  const make = (d: string, tags: string[][], createdAt = seconds) =>
    parseLiveEvent({ ...live(tags, { created_at: createdAt }), tags: [['d', d], ['title', d], ...tags] })!;

  it('sorts into live, upcoming and past', () => {
    const shelves = shelveLiveEvents([
      make('a', [['status', 'live']]),
      make('b', [['status', 'planned']]),
      make('c', [['status', 'ended']]),
    ], NOW);

    expect(shelves.live.map((l) => l.identifier)).toEqual(['a']);
    expect(shelves.upcoming.map((l) => l.identifier)).toEqual(['b']);
    expect(shelves.past.map((l) => l.identifier)).toEqual(['c']);
  });

  it('puts the busiest stream first', () => {
    const shelves = shelveLiveEvents([
      make('quiet', [['status', 'live'], ['current_participants', '2']]),
      make('busy', [['status', 'live'], ['current_participants', '90']]),
    ], NOW);

    expect(shelves.live.map((l) => l.identifier)).toEqual(['busy', 'quiet']);
  });

  it('reads the schedule forwards', () => {
    // A schedule sorted newest-first is not a schedule
    const shelves = shelveLiveEvents([
      make('later', [['status', 'planned'], ['starts', String(seconds + 7200)]]),
      make('sooner', [['status', 'planned'], ['starts', String(seconds + 600)]]),
    ], NOW);

    expect(shelves.upcoming.map((l) => l.identifier)).toEqual(['sooner', 'later']);
  });

  it('puts an unscheduled stream last rather than first', () => {
    const shelves = shelveLiveEvents([
      make('someday', [['status', 'planned']]),
      make('tuesday', [['status', 'planned'], ['starts', String(seconds + 600)]]),
    ], NOW);

    expect(shelves.upcoming.map((l) => l.identifier)).toEqual(['tuesday', 'someday']);
  });

  it('moves a stale live stream to the past shelf', () => {
    const shelves = shelveLiveEvents(
      [make('zombie', [['status', 'live']], seconds - STALE_AFTER_MS / 1000 - 60)],
      NOW
    );

    expect(shelves.live).toEqual([]);
    expect(shelves.past.map((l) => l.identifier)).toEqual(['zombie']);
  });

  it('has three empty shelves for nothing', () => {
    expect(shelveLiveEvents([], NOW)).toEqual({ live: [], upcoming: [], past: [] });
  });
});

describe('liveChatFilter', () => {
  it('asks for the chat addressed to one activity', () => {
    expect(liveChatFilter('30311:abc:stream-1')).toMatchObject({
      kinds: [1311],
      '#a': ['30311:abc:stream-1'],
    });
  });
});
