/**
 * Deterministic, really-signed Nostr events for design work.
 *
 * Two reasons this exists rather than a live relay.
 *
 * The container cannot reach jsr.io, so `@nostrify/*` installs as a types-only
 * stub with no runtime in it and the app will not boot at all — see SKILL.md.
 * This module is the other half of the replacement.
 *
 * And even with a working relay, screenshots of live data are not comparable
 * between runs: the feed moves, so every before/after diff is contaminated by
 * whatever the network did in between. Design review needs the same pixels for
 * the same code.
 *
 * Signatures are real. `nostr-tools` is a genuine npm package, so these events
 * verify — which matters because the app refuses events that do not
 * (`validateZapReceipt`, `explainZapReceipt`). Fixtures with fake signatures
 * would render as a wall of "not counted" and teach you nothing about the
 * design.
 */
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
} from 'nostr-tools';

/** Fixed so a rerun produces the same keys, and the same avatars. */
const SEED = 0x9184d9;

/** xorshift32 — tiny, deterministic, and good enough for fixture data. */
function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

const random = rng(SEED);

/** A secret key that is the same on every run. */
function fixedKey() {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = Math.floor(random() * 256);
  // Guard against the astronomically unlikely out-of-range scalar
  bytes[0] = bytes[0] % 0x7f || 1;
  return bytes;
}

const NOW = Math.floor(Date.UTC(2026, 7, 19, 12, 0, 0) / 1000);
const HOUR = 3600;
const DAY = 86400;

const PEOPLE = [
  { name: 'kkworld', about: 'Building NostrFeed. Sats, relays, and long walks.', nip05: 'kk@ln.nostrfeed.com', lud16: 'kk@ln.nostrfeed.com' },
  { name: 'ana', about: 'Photographer. Mostly film.', nip05: 'ana@nostrfeed.com', lud16: 'ana@ln.nostrfeed.com' },
  { name: 'bram', about: 'Relay operator, strfry apologist.', lud16: 'bram@ln.nostrfeed.com' },
  { name: 'chidi', about: 'Writes about protocols and moral philosophy.', lud16: 'chidi@ln.nostrfeed.com' },
  { name: 'devi', about: 'Lightning plumbing.', nip05: 'devi@nostrfeed.com' },
  { name: 'eze', about: 'Designer. Dark mode maximalist.' },
];

/** The lightning server that signs every fixture receipt. */
const providerKey = fixedKey();
export const PROVIDER = getPublicKey(providerKey);

export const actors = PEOPLE.map((person) => {
  const secret = fixedKey();
  const pubkey = getPublicKey(secret);
  return { ...person, secret, pubkey, npub: nip19.npubEncode(pubkey) };
});

/** The person the harness signs in as. */
export const ME = actors[0];

const NOTES = [
  'Spent the morning reading strfry’s negentropy implementation. It is much simpler than the paper made me expect.',
  'A zap that does not show up is worse than no zap button at all. Spent all week on this.',
  'New relay capability chips are live — you can finally see whether your relay does search before you search.',
  'Hot take: most “decentralised” clients are one relay outage away from being a very slow single-server app.',
  'Community boards need to tell you where your own post went. Ours does now.',
  'Reminder that kind 0 and kind 10002 travel together. Ask for both or you are not doing outbox.',
  'Photo dump from the coast. Film, as always.',
  'If your progress bar silently drops payments for being 40 seconds early, it is not a progress bar, it is a lottery.',
  'Sats per day is the only creator metric I actually check.',
  'Reading: “The Mythical Man-Month”, again, for the fourth time.',
];

const events = [];

function push(secret, template) {
  const event = finalizeEvent(
    { created_at: NOW, content: '', tags: [], ...template },
    secret
  );
  events.push(event);
  return event;
}

/* ---- kind 0: profiles ------------------------------------------------- */
for (const actor of actors) {
  push(actor.secret, {
    kind: 0,
    content: JSON.stringify({
      name: actor.name,
      display_name: actor.name,
      about: actor.about,
      nip05: actor.nip05,
      lud16: actor.lud16,
      /*
       * Deliberately not a remote URL. The harness runs with the network cut
       * off, so a real avatar host would render every face as a broken image
       * and the screenshot would be of the fallback path, not the design.
       */
      picture: avatarFor(actor.pubkey),
    }),
  });

  /*
   * kind 10002 alongside kind 0, matching what the app now asks for — so the
   * outbox table fills and the relay-routing code paths are actually exercised
   * rather than skipped for want of data.
   */
  push(actor.secret, {
    kind: 10002,
    tags: [
      ['r', 'wss://relay.nostrfeed.com'],
      ['r', 'wss://relay.damus.io', 'write'],
      ['r', 'wss://relay.nostr.band', 'read'],
    ],
  });
}

/** A flat SVG data URI, so faces render with the network switched off. */
function avatarFor(pubkey) {
  const hue = parseInt(pubkey.slice(0, 4), 16) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">` +
    `<rect width="96" height="96" fill="hsl(${hue} 45% 42%)"/>` +
    `<circle cx="48" cy="38" r="17" fill="hsl(${hue} 45% 72%)"/>` +
    `<rect x="20" y="62" width="56" height="40" rx="20" fill="hsl(${hue} 45% 72%)"/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/* ---- kind 1: notes ---------------------------------------------------- */
export const notes = NOTES.map((content, index) =>
  push(actors[index % actors.length].secret, {
    kind: 1,
    content,
    created_at: NOW - index * 3 * HOUR,
  })
);

/* ---- kind 30023: an article ------------------------------------------- */
export const article = push(ME.secret, {
  kind: 30023,
  created_at: NOW - 2 * DAY,
  content:
    '## Why your zap did not show\n\nA receipt is published by the *sender*’s ' +
    'lightning server, to the relays the *sender*’s client named. Not yours.\n\n' +
    'That single fact explains most of the "I paid and nothing happened" ' +
    'reports on every Nostr client, and it is not fixable by fanning out ' +
    'harder to your own relays.\n\n### What actually helps\n\n1. Ask the relays ' +
    'other clients publish to.\n2. Remember what you have already seen.\n3. Say ' +
    'out loud when a receipt arrived and was refused.\n',
  tags: [
    ['d', 'why-your-zap-did-not-show'],
    ['title', 'Why your zap did not show'],
    ['summary', 'Receipts land where the sender’s client said, not where you read.'],
    ['published_at', String(NOW - 2 * DAY)],
    ['t', 'nostr'],
    ['t', 'lightning'],
  ],
});

/* ---- kind 34550: a community ------------------------------------------ */
export const community = push(ME.secret, {
  kind: 34550,
  created_at: NOW - 40 * DAY,
  tags: [
    ['d', 'relay-operators'],
    ['name', 'Relay Operators'],
    ['description', 'People who run relays, and the people who complain to them.'],
    ['p', actors[2].pubkey, '', 'moderator'],
    ['p', actors[4].pubkey, '', 'moderator'],
    ['relay', 'wss://relay.nostrfeed.com'],
  ],
});

const communityAddress = `34550:${ME.pubkey}:relay-operators`;

/** Posts into the community — some approved, some deliberately left waiting. */
const communityPosts = [
  'Anyone else seeing negentropy sync spike memory on 1.1.1?',
  'strfry config for retention by kind — worked example inside.',
  'What is everyone charging for write access these days?',
  'My relay has been up 214 days. AMA.',
].map((content, index) =>
  push(actors[(index + 1) % actors.length].secret, {
    kind: 1111,
    content,
    created_at: NOW - (index + 1) * 6 * HOUR,
    tags: [
      ['A', communityAddress],
      ['a', communityAddress],
      ['K', '34550'],
      ['k', '34550'],
      ['P', ME.pubkey],
      ['p', ME.pubkey],
    ],
  })
);

// Only the first two are approved, so the "waiting" design has something in it
for (const post of communityPosts.slice(0, 2)) {
  push(actors[2].secret, {
    kind: 4550,
    created_at: post.created_at + 600,
    content: JSON.stringify(post),
    tags: [
      ['a', communityAddress],
      ['e', post.id],
      ['p', post.pubkey],
      ['k', String(post.kind)],
    ],
  });
}

/* ---- kind 9735: zap receipts ------------------------------------------ */
/**
 * Signed by one provider key for everything paid to `ME`, which is what the
 * real thing looks like: one LNURL server signs every receipt for one address.
 */
function receipt({ to, targetId, address, sats, comment, senderIndex, at }) {
  const sender = actors[senderIndex % actors.length];

  const request = finalizeEvent(
    {
      kind: 9734,
      created_at: at,
      content: comment ?? '',
      tags: [
        ['p', to],
        ...(address ? [['a', address]] : []),
        ...(targetId ? [['e', targetId]] : []),
        ['amount', String(sats * 1000)],
        ['relays', 'wss://relay.nostrfeed.com'],
      ],
    },
    sender.secret
  );

  return push(providerKey, {
    kind: 9735,
    created_at: at,
    tags: [
      ['p', to],
      ...(address ? [['a', address]] : []),
      ...(targetId ? [['e', targetId]] : []),
      ['bolt11', `lnbc${sats * 10}n1p${'q'.repeat(60)}`],
      ['description', JSON.stringify(request)],
    ],
  });
}

// Spread across the window so Studio's sparkline has a shape rather than a spike
const AMOUNTS = [21, 210, 500, 1000, 100, 42, 2100, 50, 333, 21, 21, 5000];
AMOUNTS.forEach((sats, index) => {
  receipt({
    to: ME.pubkey,
    targetId: notes[index % notes.length].id,
    sats,
    comment: index % 3 === 0 ? 'great post' : '',
    senderIndex: index + 1,
    at: NOW - index * 2 * DAY,
  });
});

// One on the article, addressed by coordinate rather than id — the case that
// used to report every article zap as a profile zap
receipt({
  to: ME.pubkey,
  address: `30023:${ME.pubkey}:why-your-zap-did-not-show`,
  sats: 1000,
  comment: 'worth the read',
  senderIndex: 3,
  at: NOW - 1 * DAY,
});

// One on the community itself, so ZapStats has something on that screen
receipt({
  to: ME.pubkey,
  address: communityAddress,
  sats: 250,
  senderIndex: 2,
  at: NOW - 3 * DAY,
});

/* ---- kind 3: follows, so counts are not all zero ---------------------- */
for (const actor of actors.slice(1)) {
  push(actor.secret, {
    kind: 3,
    tags: actors.map((other) => ['p', other.pubkey]),
  });
}

/* ---- reactions and reposts, so the action row is not all zeroes ------- */
notes.slice(0, 5).forEach((note, index) => {
  push(actors[(index + 2) % actors.length].secret, {
    kind: 7,
    content: '+',
    created_at: note.created_at + 300,
    tags: [['e', note.id], ['p', note.pubkey]],
  });
  if (index % 2 === 0) {
    push(actors[(index + 3) % actors.length].secret, {
      kind: 6,
      created_at: note.created_at + 600,
      tags: [['e', note.id], ['p', note.pubkey]],
    });
  }
});

/** Every fixture event, newest first. */
export const ALL = events.sort((a, b) => b.created_at - a.created_at);

/** NIP-01 filter matching, enough for what the app asks for. */
export function matches(event, filter) {
  if (filter.ids?.length && !filter.ids.includes(event.id)) return false;
  if (filter.kinds?.length && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors?.length && !filter.authors.includes(event.pubkey)) {
    return false;
  }
  if (typeof filter.since === 'number' && event.created_at < filter.since) {
    return false;
  }
  if (typeof filter.until === 'number' && event.created_at > filter.until) {
    return false;
  }

  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#') || !Array.isArray(values)) continue;

    const name = key.slice(1);
    const has = event.tags.some(
      ([tagName, value]) => tagName === name && values.includes(value)
    );
    if (!has) return false;
  }

  /*
   * `search` is answered by substring rather than ignored. A relay without
   * NIP-50 ignores the field and returns recent events, which is a real
   * behaviour worth being able to see — but the harness is the *indexed*
   * relay, since the un-indexed path is the one the app compensates for and
   * you cannot review a compensation you never trigger.
   */
  if (filter.search) {
    const needle = String(filter.search).toLowerCase();
    if (!event.content.toLowerCase().includes(needle)) return false;
  }

  return true;
}

/** Everything matching any of the filters, newest first, honouring `limit`. */
export function query(filters) {
  const found = new Map();

  for (const filter of filters) {
    let taken = 0;
    for (const event of ALL) {
      if (taken >= (filter.limit ?? 500)) break;
      if (!matches(event, filter)) continue;

      found.set(event.id, event);
      taken += 1;
    }
  }

  return [...found.values()].sort((a, b) => b.created_at - a.created_at);
}
