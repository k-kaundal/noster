import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  FOLLOW_KIND,
  buildNotifications,
  filterNotifications,
  groupZaps,
  repostedContent,
  toNotification,
  type Notification,
} from './notifications';
import { formatSats, parseZapReceipt } from './zap';

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);
/** The recipient's LNURL server, which signs zap receipts. */
const ZAPPER_SERVICE = 'c'.repeat(64);
const NOTE = 'd'.repeat(64);

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '1'.repeat(64),
    pubkey: THEM,
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: '',
    sig: 'f'.repeat(128),
    ...overrides,
  };
}

function zapReceipt({
  sender = THEM,
  amountMillisats = 21_000,
  comment = '',
  targetId = NOTE,
}: {
  sender?: string;
  amountMillisats?: number;
  comment?: string;
  targetId?: string | null;
} = {}): NostrEvent {
  const request = {
    kind: 9734,
    pubkey: sender,
    content: comment,
    tags: [
      ['p', ME],
      ...(targetId ? [['e', targetId]] : []),
      ['amount', String(amountMillisats)],
    ],
  };

  return event({
    kind: 9735,
    // Signed by the payment processor, not the person who paid
    pubkey: ZAPPER_SERVICE,
    tags: [
      ['p', ME],
      ...(targetId ? [['e', targetId]] : []),
      ['description', JSON.stringify(request)],
    ],
  });
}

describe('parseZapReceipt', () => {
  it('credits the sender rather than the receipt signer', () => {
    const parsed = parseZapReceipt(zapReceipt());

    expect(parsed.senderPubkey).toBe(THEM);
    expect(parsed.senderPubkey).not.toBe(ZAPPER_SERVICE);
  });

  it('converts the request amount from millisats to sats', () => {
    expect(parseZapReceipt(zapReceipt({ amountMillisats: 21_000 })).amountSats)
      .toBe(21);
  });

  it('reads the zapper message and target', () => {
    const parsed = parseZapReceipt(zapReceipt({ comment: '  nice post  ' }));

    expect(parsed.comment).toBe('nice post');
    expect(parsed.targetEventId).toBe(NOTE);
    expect(parsed.recipientPubkey).toBe(ME);
  });

  it('falls back to the uppercase P tag when the request is unreadable', () => {
    const receipt = event({
      kind: 9735,
      pubkey: ZAPPER_SERVICE,
      tags: [
        ['p', ME],
        ['P', THEM],
        ['description', 'not json'],
      ],
    });

    expect(parseZapReceipt(receipt).senderPubkey).toBe(THEM);
  });

  it('reports no amount rather than guessing when none is present', () => {
    const receipt = event({ kind: 9735, pubkey: ZAPPER_SERVICE, tags: [['p', ME]] });
    expect(parseZapReceipt(receipt).amountSats).toBeNull();
  });
});

describe('formatSats', () => {
  it('abbreviates large amounts and leaves small ones alone', () => {
    expect(formatSats(21)).toBe('21');
    expect(formatSats(999)).toBe('999');
    expect(formatSats(1000)).toBe('1k');
    expect(formatSats(1200)).toBe('1.2k');
    expect(formatSats(21_000)).toBe('21k');
    expect(formatSats(2_100_000)).toBe('2.1M');
  });
});

describe('toNotification', () => {
  it('classifies a bare mention', () => {
    const result = toNotification(
      event({ content: 'hey @you', tags: [['p', ME]] }),
      ME
    );

    expect(result?.type).toBe('mention');
    expect(result?.targetEventId).toBeNull();
  });

  it('classifies a note that answers one of yours as a reply', () => {
    const result = toNotification(
      event({ tags: [['e', NOTE], ['p', ME]], content: 'agreed' }),
      ME
    );

    expect(result?.type).toBe('reply');
    expect(result?.targetEventId).toBe(NOTE);
  });

  it('prefers the marked reply tag over tag order', () => {
    const result = toNotification(
      event({
        tags: [
          ['e', '9'.repeat(64), '', 'root'],
          ['e', NOTE, '', 'reply'],
          ['p', ME],
        ],
      }),
      ME
    );

    expect(result?.targetEventId).toBe(NOTE);
  });

  it('classifies reactions and both repost kinds', () => {
    expect(toNotification(event({ kind: 7, content: '+' }), ME)?.type).toBe(
      'reaction'
    );
    expect(toNotification(event({ kind: 6 }), ME)?.type).toBe('repost');
    expect(toNotification(event({ kind: 16 }), ME)?.type).toBe('repost');
  });

  it('normalises the reaction content for display', () => {
    expect(toNotification(event({ kind: 7, content: '+' }), ME)?.content).toBe(
      '❤️'
    );
  });

  it('attributes a zap to its sender with the amount attached', () => {
    const result = toNotification(zapReceipt({ amountMillisats: 5000 }), ME);

    expect(result?.type).toBe('zap');
    expect(result?.pubkey).toBe(THEM);
    expect(result?.amountSats).toBe(5);
  });

  it('drops your own activity', () => {
    expect(toNotification(event({ pubkey: ME, kind: 7 }), ME)).toBeNull();
    expect(toNotification(zapReceipt({ sender: ME }), ME)).toBeNull();
  });

  it('drops a zap receipt with no identifiable sender', () => {
    const receipt = event({ kind: 9735, pubkey: ZAPPER_SERVICE, tags: [['p', ME]] });
    expect(toNotification(receipt, ME)).toBeNull();
  });
});

describe('buildNotifications', () => {
  it('sorts newest first and collapses events relays sent twice', () => {
    const older = event({ id: '1'.repeat(64), kind: 7, created_at: 100 });
    const newer = event({ id: '2'.repeat(64), kind: 6, created_at: 200 });

    const result = buildNotifications([older, newer, older], ME);

    expect(result.map((n) => n.event.id)).toEqual([newer.id, older.id]);
  });
});

describe('filterNotifications', () => {
  const notifications = buildNotifications(
    [
      event({ id: '1'.repeat(64), kind: 7, created_at: 400 }),
      event({ id: '2'.repeat(64), kind: 6, created_at: 300 }),
      event({ id: '3'.repeat(64), created_at: 200, content: 'hi', tags: [['p', ME]] }),
      event({ id: '4'.repeat(64), created_at: 100, tags: [['e', NOTE], ['p', ME]] }),
    ],
    ME
  );

  it('returns everything for "all"', () => {
    expect(filterNotifications(notifications, 'all')).toHaveLength(4);
  });

  it('groups mentions and replies under one tab', () => {
    expect(filterNotifications(notifications, 'mentions').map((n) => n.type))
      .toEqual(['mention', 'reply']);
  });

  it('narrows to a single type', () => {
    expect(filterNotifications(notifications, 'reactions')).toHaveLength(1);
    expect(filterNotifications(notifications, 'reposts')).toHaveLength(1);
    expect(filterNotifications(notifications, 'zaps')).toHaveLength(0);
  });
});

describe('repostedContent', () => {
  const original = {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: 1,
    tags: [['t', 'nostr']],
    content: 'Just shipped something.',
    sig: 'c'.repeat(128),
  };

  function repost(content: string): NostrEvent {
    return {
      id: 'd'.repeat(64),
      pubkey: 'e'.repeat(64),
      created_at: 2,
      kind: 6,
      tags: [['e', original.id]],
      content,
      sig: '',
    } as NostrEvent;
  }

  it('unwraps the embedded event rather than printing it', () => {
    // The bug: the whole serialised event, signature and all, was shown as
    // the notification's preview text
    expect(repostedContent(repost(JSON.stringify(original)))).toBe(
      'Just shipped something.'
    );
  });

  it('shows nothing for the empty repost most clients send', () => {
    expect(repostedContent(repost(''))).toBe('');
    expect(repostedContent(repost('   '))).toBe('');
  });

  it('shows nothing rather than a fragment of broken JSON', () => {
    expect(repostedContent(repost('{"id":"abc","content":'))).toBe('');
  });

  it('keeps plain text a client chose to put there', () => {
    expect(repostedContent(repost('worth reading'))).toBe('worth reading');
  });

  it('shows nothing when the embedded event has no content field', () => {
    expect(repostedContent(repost('{"id":"abc"}'))).toBe('');
  });

  it('builds a repost notification with the original text', () => {
    const [notification] = buildNotifications(
      [repost(JSON.stringify(original))],
      'f'.repeat(64)
    );

    expect(notification.type).toBe('repost');
    expect(notification.content).toBe('Just shipped something.');
  });
});

describe('quotes', () => {
  const me = 'f'.repeat(64);
  const them = 'e'.repeat(64);
  const myNote = 'a'.repeat(64);

  function kind1(tags: string[][]): NostrEvent {
    return {
      id: 'd'.repeat(64),
      pubkey: them,
      created_at: 2,
      kind: 1,
      tags,
      content: 'worth reading',
      sig: '',
    } as NostrEvent;
  }

  it('reads a q tag as a quote, not a reply', () => {
    const notification = toNotification(kind1([['q', myNote, '', me]]), me);

    expect(notification?.type).toBe('quote');
    expect(notification?.targetEventId).toBe(myNote);
  });

  it('reads the older mention marker as a quote too', () => {
    const notification = toNotification(
      kind1([['e', myNote, '', 'mention']]),
      me
    );

    expect(notification?.type).toBe('quote');
    expect(notification?.targetEventId).toBe(myNote);
  });

  it('still calls an actual reply a reply', () => {
    const notification = toNotification(
      kind1([['e', myNote, '', 'root']]),
      me
    );

    expect(notification?.type).toBe('reply');
  });

  it('prefers the reply when a note both replies and quotes', () => {
    const notification = toNotification(
      kind1([
        ['e', myNote, '', 'root'],
        ['q', 'b'.repeat(64)],
      ]),
      me
    );

    expect(notification?.type).toBe('reply');
    expect(notification?.targetEventId).toBe(myNote);
  });

  it('is still a mention when nothing is referenced', () => {
    expect(toNotification(kind1([['p', me]]), me)?.type).toBe('mention');
  });
});

describe('follows', () => {
  const contactList = (overrides: Partial<NostrEvent> = {}) =>
    event({
      kind: FOLLOW_KIND,
      tags: [['p', ME]],
      // A contact list's content is a relay blob, never a message to anyone
      content: '{"wss://relay.example":{"read":true,"write":true}}',
      ...overrides,
    });

  it('reads a contact list naming you as a follow', () => {
    const notification = toNotification(contactList(), ME);

    expect(notification?.type).toBe('follow');
    expect(notification?.pubkey).toBe(THEM);
  });

  it('carries no content, so the row does not print a relay blob', () => {
    expect(toNotification(contactList(), ME)?.content).toBe('');
  });

  it('ignores a list that does not actually name you', () => {
    // A relay's #p filter matches any p tag, and reporting a loose match would
    // announce a follow that did not happen
    expect(
      toNotification(contactList({ tags: [['p', THEM]] }), ME)
    ).toBeNull();
  });

  it('ignores your own contact list', () => {
    expect(
      toNotification(contactList({ pubkey: ME, tags: [['p', ME]] }), ME)
    ).toBeNull();
  });

  it('keeps one row per follower when a relay holds several versions', () => {
    // Kind 3 is replaceable and people edit their follows, so without this a
    // single reader reorganising their list fills your notifications
    const built = buildNotifications(
      [
        contactList({ id: '2'.repeat(64), created_at: 1_700_000_100 }),
        contactList({ id: '3'.repeat(64), created_at: 1_700_000_200 }),
        contactList({ id: '4'.repeat(64), created_at: 1_700_000_050 }),
      ],
      ME
    );

    expect(built).toHaveLength(1);
    expect(built[0].createdAt).toBe(1_700_000_200);
  });

  it('keeps a row each for two different followers', () => {
    const other = 'e'.repeat(64);

    const built = buildNotifications(
      [
        contactList({ id: '2'.repeat(64) }),
        contactList({ id: '3'.repeat(64), pubkey: other }),
      ],
      ME
    );

    expect(built.map((entry) => entry.pubkey).sort()).toEqual(
      [THEM, other].sort()
    );
  });

  it('does not collapse anything that is not a follow', () => {
    const built = buildNotifications(
      [
        event({ id: '2'.repeat(64), kind: 7, tags: [['e', NOTE]], content: '+' }),
        event({ id: '3'.repeat(64), kind: 7, tags: [['e', NOTE]], content: '🔥' }),
      ],
      ME
    );

    expect(built).toHaveLength(2);
  });

  it('has a filter of its own', () => {
    const built = buildNotifications(
      [
        contactList({ id: '2'.repeat(64) }),
        event({ id: '3'.repeat(64), kind: 7, tags: [['e', NOTE]], content: '+' }),
      ],
      ME
    );

    expect(filterNotifications(built, 'follows')).toHaveLength(1);
    expect(filterNotifications(built, 'follows')[0].type).toBe('follow');
  });
});

describe('groupZaps', () => {
  const zap = (
    id: string,
    target: string | null,
    pubkey: string,
    sats: number,
    createdAt: number
  ): Notification => ({
    event: { id, kind: 9735, pubkey, created_at: createdAt, content: '', tags: [], sig: '' },
    type: 'zap',
    pubkey,
    createdAt,
    targetEventId: target,
    content: '',
    amountSats: sats,
  });

  it('merges the zaps on one note into a single row', () => {
    /*
     * A note that does well produces a notification per zap, arriving
     * together — so the list a creator most wants to read becomes a wall of
     * the same note, with everything else pushed off the first screen.
     */
    const rows = groupZaps([
      zap('a', 'note-1', 'alice', 1000, 300),
      zap('b', 'note-1', 'bob', 2000, 200),
      zap('c', 'note-1', 'carol', 3300, 100),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].zapperCount).toBe(3);
    expect(rows[0].totalSats).toBe(6300);
  });

  it('keeps the newest zap as the row', () => {
    // It carries the right timestamp and the most recent comment
    const rows = groupZaps([
      zap('old', 'note-1', 'alice', 100, 100),
      zap('new', 'note-1', 'bob', 100, 900),
    ]);

    expect(rows[0].event.id).toBe('new');
    expect(rows[0].createdAt).toBe(900);
  });

  it('totals correctly whichever order they arrive in', () => {
    const forwards = groupZaps([
      zap('a', 'n', 'alice', 100, 100),
      zap('b', 'n', 'bob', 250, 900),
    ]);
    const backwards = groupZaps([
      zap('b', 'n', 'bob', 250, 900),
      zap('a', 'n', 'alice', 100, 100),
    ]);

    expect(forwards[0].totalSats).toBe(350);
    expect(backwards[0].totalSats).toBe(350);
  });

  it('counts people, not payments', () => {
    // Somebody zapping the same note three times is one person who liked it
    const rows = groupZaps([
      zap('a', 'n', 'alice', 100, 300),
      zap('b', 'n', 'alice', 100, 200),
      zap('c', 'n', 'alice', 100, 100),
    ]);

    expect(rows[0].zapperCount).toBe(1);
    expect(rows[0].totalSats).toBe(300);
  });

  it('keeps different notes apart', () => {
    const rows = groupZaps([
      zap('a', 'note-1', 'alice', 100, 200),
      zap('b', 'note-2', 'bob', 100, 100),
    ]);

    expect(rows).toHaveLength(2);
  });

  it('leaves profile zaps alone', () => {
    /*
     * They have no target to group by, and bucketing every zap somebody ever
     * sent you into one row would collapse a history into a single line.
     */
    const rows = groupZaps([
      zap('a', null, 'alice', 100, 200),
      zap('b', null, 'bob', 100, 100),
    ]);

    expect(rows).toHaveLength(2);
  });

  it('leaves everything that is not a zap untouched', () => {
    const reply: Notification = {
      event: { id: 'r', kind: 1, pubkey: 'x', created_at: 5, content: 'hi', tags: [], sig: '' },
      type: 'reply',
      pubkey: 'x',
      createdAt: 5,
      targetEventId: 'note-1',
      content: 'hi',
      amountSats: null,
    };

    const rows = groupZaps([reply, zap('a', 'note-1', 'alice', 100, 200)]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(reply);
  });

  it('keeps the row in the place the newest zap held', () => {
    // Otherwise a merged row jumps to wherever its oldest member was
    const rows = groupZaps([
      zap('a', 'note-1', 'alice', 100, 900),
      zap('b', 'note-2', 'bob', 100, 500),
      zap('c', 'note-1', 'carol', 100, 100),
    ]);

    expect(rows.map((row) => row.targetEventId)).toEqual(['note-1', 'note-2']);
  });

  it('has nothing to group in an empty list', () => {
    expect(groupZaps([])).toEqual([]);
  });
});
