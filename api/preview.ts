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
export function cardTags(card: Card, url: string): string {
  return [
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
}

export function injectCard(html: string, card: Card, url: string): string {
  const stripped = html.replace(
    /\s*<meta\s+(?:property|name)="(?:og:(?:title|description|image|url|type)|twitter:(?:card|title|description|image))"[^>]*>/gi,
    ''
  );

  const tags = cardTags(card, url);

  const titled = stripped.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escape(card.title)}</title>`
  );

  return titled.replace(/<\/head>/i, `${tags}</head>`);
}

/**
 * Node's request and response, structurally.
 *
 * Vercel's Node runtime calls this with an `IncomingMessage` and a
 * `ServerResponse`, not with the Web `Request` this was first written against
 * — which is why every one of these routes returned 500: `request.url` is a
 * path there, and `new URL('/npub1…')` throws. Described here rather than
 * imported from `node:http` so the function needs no type dependency.
 */
interface NodeRequest {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface NodeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

function header(request: NodeRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The full URL of a request that only knows its own path.
 *
 * The host comes from the proxy in front of the function, and is a header
 * anybody can send — so it is only ever used to fetch this deployment's own
 * shell and to fill in `og:url`. A forged one produces a wrong card, never a
 * request anywhere else, because the path is fixed and the scheme is not taken
 * from input.
 */
export function absoluteUrl(path: string | undefined, host: string): URL {
  return new URL(path || '/', `https://${host || 'www.nostrfeed.com'}`);
}

/**
 * The app shell, held for the life of a warm instance.
 *
 * Read over HTTP from this same deployment rather than off disk, because a
 * function bundle does not contain the static output. `/index.html` is a real
 * file, and Vercel serves files before it applies rewrites, so this cannot
 * come back through here.
 *
 * A failure is deliberately not cached: an instance that started while the
 * deployment was still settling would otherwise serve a card-only page for as
 * long as it lived.
 */
let shell: Promise<string> | undefined;

function loadShell(origin: string): Promise<string> {
  shell ??= fetch(`${origin}/index.html`)
    .then((response) => (response.ok ? response.text() : ''))
    .then((html) => {
      if (!html) shell = undefined;
      return html;
    })
    .catch(() => {
      shell = undefined;
      return '';
    });

  return shell;
}

function send(response: NodeResponse, html: string, seconds: number): void {
  response.statusCode = 200;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.setHeader(
    'cache-control',
    `public, s-maxage=${seconds}, stale-while-revalidate=86400`
  );
  response.end(html);
}

/**
 * The card on its own, when the shell could not be read.
 *
 * Only reachable by something that does not run JavaScript anyway — the
 * rewrite sends people to the static page — so a head full of correct tags is
 * the whole of what this reader wanted. Still a 200: a 404 tells every crawler
 * the article does not exist, which is the fault this function exists to fix.
 */
function bareCard(card: Card | null, url: string): string {
  const title = card?.title ?? SITE_NAME;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(
    title
  )}</title>${card ? cardTags(card, url) : ''}</head><body></body></html>`;
}

export default async function handler(
  request: NodeRequest,
  response: NodeResponse
): Promise<void> {
  let url: URL;
  let identifier = '';

  try {
    url = absoluteUrl(
      request.url,
      header(request, 'x-forwarded-host') ?? header(request, 'host') ?? ''
    );

    /*
     * The rewrite passes the matched segment as `id`. The path is read as a
     * fallback for a direct hit, and both are the same string.
     */
    identifier =
      url.searchParams.get('id') ??
      url.pathname.replace(/^\/+/, '').split('/')[0];
  } catch {
    // Nothing can be built without a URL, and there is nothing to fall back
    // to that does not need one
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('');
    return;
  }

  const page = `${url.origin}${url.pathname}`;

  /**
   * One boundary around the whole of it.
   *
   * This function replaced a page that worked. Anything it cannot do — a relay
   * that hangs, a shape nobody predicted, a bug like the one that made every
   * profile 500 — has to end as the page without a card, never as an error.
   */
  try {
    const filter = filterFor(identifier);
    const event = filter ? await findEvent(filter).catch(() => null) : null;

    /*
     * A note says who wrote it but not what they are called, and "somebody on
     * NostrFeed said this" is most of the value of the card. Skipped for a
     * kind 0, which is already the profile.
     */
    const profile =
      !event || event.kind === 0
        ? undefined
        : (await findEvent({ kinds: [0], authors: [event.pubkey] }).catch(
            () => null
          )) ?? undefined;

    const card = event ? cardFor(event, profile) : null;
    const html = await loadShell(url.origin);

    if (!html) {
      send(response, bareCard(card, page), card ? CACHE_SECONDS : 60);
      return;
    }

    if (!card) {
      // Briefly, so a relay that was down does not fix itself into the cache
      send(response, html, 60);
      return;
    }

    send(response, injectCard(html, card, page), CACHE_SECONDS);
  } catch {
    const html = await loadShell(url.origin).catch(() => '');
    send(response, html || bareCard(null, page), 60);
  }
}
