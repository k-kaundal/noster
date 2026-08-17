/**
 * Link previews for notes, profiles and articles.
 *
 * Everything else on this site gets its card tags baked into a file at build
 * time by `scripts/seo-build.mjs`. These routes cannot be: `/naddr1…` is an
 * article on a relay somewhere, the set is unbounded, and there is no
 * build-time list to write files from.
 *
 * The app fills the tags in with `useSeo` once it boots, which is enough for
 * Google — it renders JavaScript before it reads. It is enough for nothing
 * else. Twitter, Slack, WhatsApp, Discord, Telegram, iMessage and every LLM
 * crawler fetch the URL, read the HTML as served, and stop. A tag written by
 * JavaScript is a tag they never see, so every article anybody shared previewed
 * as the site's front door.
 *
 * So this fetches the event and writes the tags into the HTML before it is
 * served. It is the only fix that works, and it has to run on a server, which
 * is why it is a function on the host that is already serving the files rather
 * than anything new to deploy.
 *
 * Everything here degrades to the page as it was: a relay that does not answer,
 * an identifier that does not decode, an event that does not exist, a fetch
 * that times out. A preview is worth a round trip and is never worth a blank
 * page.
 */

/** Relays asked, in the order they are asked. */
const RELAYS = [
  'wss://relay.nostr.band',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
];

/**
 * How long to wait for an event.
 *
 * A preview fetcher gives up somewhere around five seconds, so a slow answer
 * and no answer are the same outcome — and the generic card renders sooner.
 */
const RELAY_TIMEOUT = 2500;

/** How long the CDN may serve a built card without asking again. */
const CACHE_SECONDS = 600;

const SITE_NAME = 'NostrFeed';

interface NostrEvent {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
}

type Filter = Record<string, unknown>;

/**
 * Asks one relay for one event.
 *
 * Written against the raw protocol rather than a client library because this
 * runs once per cold request on a host that bills by the millisecond, and
 * NIP-01 is four message types.
 */
function queryRelay(url: string, filter: Filter): Promise<NostrEvent | null> {
  return new Promise((resolve) => {
    let socket: WebSocket;
    let settled = false;

    const finish = (event: NostrEvent | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closing, or never opened
      }
      resolve(event);
    };

    const timer = setTimeout(() => finish(null), RELAY_TIMEOUT);

    try {
      socket = new WebSocket(url);
    } catch {
      finish(null);
      return;
    }

    socket.onerror = () => finish(null);
    socket.onclose = () => finish(null);

    socket.onopen = () => {
      socket.send(JSON.stringify(['REQ', 'p', { ...filter, limit: 1 }]));
    };

    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data)) as unknown[];

        if (data[0] === 'EVENT') finish(data[2] as NostrEvent);
        // EOSE with nothing before it means this relay does not have it
        if (data[0] === 'EOSE') finish(null);
      } catch {
        finish(null);
      }
    };
  });
}

/** The first relay with an answer wins; the rest are not waited for. */
async function findEvent(filter: Filter): Promise<NostrEvent | null> {
  const answers = await Promise.all(
    RELAYS.map((url) => queryRelay(url, filter))
  );

  return answers.find((event): event is NostrEvent => !!event) ?? null;
}

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Enough bech32 to read a NIP-19 identifier.
 *
 * The checksum is not verified: this decides which relay filter to build, and
 * a corrupt identifier produces a filter that matches nothing, which is
 * already the behaviour for one that decodes cleanly and names no event.
 */
function fromBech32(input: string): { prefix: string; bytes: number[] } | null {
  const lower = input.toLowerCase();
  const split = lower.lastIndexOf('1');
  if (split < 1) return null;

  const prefix = lower.slice(0, split);
  const body = lower.slice(split + 1);
  if (body.length < 7) return null;

  const values: number[] = [];
  // The last six characters are the checksum
  for (const char of body.slice(0, -6)) {
    const value = CHARSET.indexOf(char);
    if (value === -1) return null;
    values.push(value);
  }

  // 5-bit groups back to 8-bit bytes
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const value of values) {
    acc = (acc << 5) | value;
    bits += 5;

    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }

  return { prefix, bytes };
}

const hex = (bytes: number[]) =>
  bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** TLV, as NIP-19 uses for `nevent`, `nprofile` and `naddr`. */
function readTlv(bytes: number[]): Map<number, number[][]> {
  const found = new Map<number, number[][]>();

  for (let i = 0; i + 1 < bytes.length; ) {
    const type = bytes[i];
    const length = bytes[i + 1];
    const value = bytes.slice(i + 2, i + 2 + length);

    if (value.length !== length) break;

    found.set(type, [...(found.get(type) ?? []), value]);
    i += 2 + length;
  }

  return found;
}

/** The relay filter that finds whatever an identifier names. */
export function filterFor(identifier: string): Filter | null {
  const decoded = fromBech32(identifier);
  if (!decoded) return null;

  const { prefix, bytes } = decoded;

  if (prefix === 'npub') {
    return bytes.length >= 32
      ? { kinds: [0], authors: [hex(bytes.slice(0, 32))] }
      : null;
  }

  if (prefix === 'note') {
    return bytes.length >= 32 ? { ids: [hex(bytes.slice(0, 32))] } : null;
  }

  const tlv = readTlv(bytes);
  const special = tlv.get(0)?.[0];
  if (!special) return null;

  if (prefix === 'nprofile') {
    return { kinds: [0], authors: [hex(special)] };
  }

  if (prefix === 'nevent') {
    return { ids: [hex(special)] };
  }

  if (prefix === 'naddr') {
    const author = tlv.get(2)?.[0];
    const kind = tlv.get(3)?.[0];
    if (!author || !kind || kind.length !== 4) return null;

    // Big-endian uint32
    const kindNumber =
      (kind[0] << 24) | (kind[1] << 16) | (kind[2] << 8) | kind[3];

    return {
      kinds: [kindNumber],
      authors: [hex(author)],
      '#d': [new TextDecoder().decode(new Uint8Array(special))],
    };
  }

  return null;
}

interface Card {
  title: string;
  description: string;
  image?: string;
}

const tagValue = (event: NostrEvent, name: string) =>
  event.tags.find(([tagName]) => tagName === name)?.[1];

/** Collapses whitespace and trims to something a card will actually show. */
function trim(text: string, length: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/** What to say about an event, by what kind of thing it is. */
export function cardFor(event: NostrEvent, profile?: NostrEvent): Card | null {
  const named = (() => {
    if (!profile) return {};
    try {
      return JSON.parse(profile.content) as {
        name?: string;
        display_name?: string;
        about?: string;
        picture?: string;
      };
    } catch {
      return {};
    }
  })();

  const author = named.display_name || named.name;

  if (event.kind === 0) {
    let metadata: typeof named = {};
    try {
      metadata = JSON.parse(event.content) as typeof named;
    } catch {
      metadata = {};
    }

    const name = metadata.display_name || metadata.name;
    if (!name && !metadata.about) return null;

    return {
      title: `${name ?? 'Profile'} on ${SITE_NAME}`,
      description: trim(metadata.about ?? `${name} on Nostr.`, 200),
      image: metadata.picture,
    };
  }

  // Long-form content carries its own title, summary and cover image
  if (event.kind === 30023 || event.kind === 30024) {
    const title = tagValue(event, 'title');
    const summary = tagValue(event, 'summary');

    return {
      title: title ? trim(title, 110) : `Article on ${SITE_NAME}`,
      description: trim(summary || event.content, 200),
      image: tagValue(event, 'image'),
    };
  }

  if (!event.content.trim()) return null;

  return {
    title: author ? `${author} on ${SITE_NAME}` : `Note on ${SITE_NAME}`,
    description: trim(event.content, 200),
    image: named.picture,
  };
}

const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Replaces the generic card in the served HTML with this one.
 *
 * The existing tags are removed rather than added to. Two `og:title` tags is
 * not "the more specific one wins" — it is undefined, and several fetchers
 * take the first, which is the one being replaced.
 */
export function injectCard(html: string, card: Card, url: string): string {
  const stripped = html.replace(
    /\s*<meta\s+(?:property|name)="(?:og:(?:title|description|image|url|type)|twitter:(?:card|title|description|image))"[^>]*>/gi,
    ''
  );

  const tags = [
    `<meta property="og:type" content="article">`,
    `<meta property="og:url" content="${escape(url)}">`,
    `<meta property="og:title" content="${escape(card.title)}">`,
    `<meta property="og:description" content="${escape(card.description)}">`,
    `<meta name="twitter:card" content="${
      card.image ? 'summary_large_image' : 'summary'
    }">`,
    `<meta name="twitter:title" content="${escape(card.title)}">`,
    `<meta name="twitter:description" content="${escape(card.description)}">`,
    ...(card.image
      ? [
          `<meta property="og:image" content="${escape(card.image)}">`,
          `<meta name="twitter:image" content="${escape(card.image)}">`,
        ]
      : []),
  ].join('');

  const titled = stripped.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escape(card.title)}</title>`
  );

  return titled.replace(/<\/head>/i, `${tags}</head>`);
}

/** The app shell, fetched once per warm instance rather than per request. */
let shell: Promise<string> | undefined;

function loadShell(origin: string): Promise<string> {
  /*
   * Read over HTTP from this same deployment rather than off disk: a function
   * bundle does not contain the static output, and `/index.html` is a real
   * file so it is served directly without coming back through the rewrite.
   */
  shell ??= fetch(`${origin}/index.html`)
    .then((response) => (response.ok ? response.text() : ''))
    .catch(() => '');

  return shell;
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const identifier = url.pathname.replace(/^\/+/, '').split('/')[0];

  const html = await loadShell(url.origin);

  /*
   * Nothing to serve and nothing to fall back to. Better an empty 200 than a
   * 404 — this path is a real page, it is just one the shell could not be read
   * for, and a 404 tells every crawler the article does not exist.
   */
  if (!html) {
    return new Response('', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const generic = () =>
    new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Briefly, so a relay that was down does not fix itself into the cache
        'cache-control': 'public, s-maxage=60',
      },
    });

  const filter = filterFor(identifier);
  if (!filter) return generic();

  const event = await findEvent(filter).catch(() => null);
  if (!event) return generic();

  /*
   * A note says who wrote it but not what they are called, and "somebody on
   * NostrFeed said this" is most of the value of the card. Skipped for a kind
   * 0, which is already the profile.
   */
  const profile =
    event.kind === 0
      ? undefined
      : (await findEvent({ kinds: [0], authors: [event.pubkey] }).catch(
          () => null
        )) ?? undefined;

  const card = cardFor(event, profile);
  if (!card) return generic();

  return new Response(injectCard(html, card, `${url.origin}${url.pathname}`), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`,
    },
  });
}
