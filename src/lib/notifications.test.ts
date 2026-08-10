import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  buildNotifications,
  filterNotifications,
  repostedContent,
  toNotification,
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
