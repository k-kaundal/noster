/**
 * The GetZap identity directory.
 *
 * One thing only: searching the names this deployment issues. Everything else
 * the API offers — resolving a pack, the unsigned setup events — this app
 * already does against LNbits directly, and routing working code through a
 * second service buys nothing but a second thing that can be down.
 *
 * A directory is different. Nostr has no way to ask "who is `ana`?": relay
 * search is NIP-50, which this deployment's strfry does not implement, and
 * even a relay that did would be searching note text rather than a namespace.
 * So this is the one question the app genuinely cannot answer on its own.
 *
 * Written to be absent without consequence. It is never on the path of
 * signing in, posting, or being paid — it decorates a search box — so every
 * failure here resolves to "no directory results" rather than an error, and a
 * short timeout means a dead API costs a moment rather than the search.
 */
import { nip19 } from 'nostr-tools';

/** Where the directory lives. Unset means the app simply has no directory. */
export const GETZAP_API = (import.meta.env.VITE_GETZAP_API ?? '').replace(
  /\/+$/,
  ''
);

export const hasDirectory = !!GETZAP_API;

/**
 * Short on purpose.
 *
 * This runs while somebody is typing. The relay results arrive in their own
 * time and the directory must not be what the box is waiting for — better a
 * search with one section missing than a search that feels broken.
 */
const TIMEOUT = 2500;

/** How many hits are worth showing under a search box. */
export const MAX_HITS = 6;

export interface DirectoryHit {
  /** The local part, e.g. `kk`. */
  name: string;
  /** The whole identity, e.g. `kk@getzap.me`. */
  identity: string;
  /** Hex, always — the API may answer with either form. */
  pubkey: string;
  npub: string;
  /** Whether the name is live. An expired reservation is not a person. */
  active: boolean;
  lud16?: string;
}

/**
 * A pubkey in whatever form the API sent, as hex.
 *
 * The spec says `pubkey` is 64 hex and `npub` is bech32, and both are
 * optional in the response schema — so neither can be assumed present or
 * well-formed. A hit whose key cannot be read is dropped rather than rendered
 * as a link to nowhere.
 */
function readPubkey(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;

  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();

  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    // Not an identifier this app understands
  }

  return null;
}

/**
 * Reads the API's answer into something safe to render.
 *
 * Every field is checked rather than trusted. This is a separate service on a
 * separate deployment cycle, and a client that assumes a shape it was promised
 * is a client that white-screens the day the shape changes.
 */
export function parseDirectory(body: unknown): DirectoryHit[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];

  const hits: DirectoryHit[] = [];
  const seen = new Set<string>();

  for (const entry of results) {
    if (!entry || typeof entry !== 'object') continue;

    const row = entry as Record<string, unknown>;
    const pubkey = readPubkey(row.pubkey) ?? readPubkey(row.npub);
    if (!pubkey) continue;

    const identity =
      typeof row.identity === 'string' && row.identity ? row.identity : '';
    const name =
      typeof row.name === 'string' && row.name
        ? row.name
        : identity.split('@')[0];

    // A row naming nobody is a row nobody can be sent to
    if (!name) continue;

    /*
     * Deduplicated on the identity rather than the key. One person may hold
     * several names, and each is a distinct thing to search for — but the same
     * name arriving twice is noise.
     */
    const key = identity || `${name}@?`;
    if (seen.has(key)) continue;
    seen.add(key);

    hits.push({
      name,
      identity: identity || name,
      pubkey,
      npub: nip19.npubEncode(pubkey),
      /*
       * Absent means live. The field is optional in the schema, and hiding a
       * name because the API declined to mention its state would make the
       * directory look empty on any deployment that omits it.
       */
      active: row.active !== false,
      lud16: typeof row.lud16 === 'string' && row.lud16 ? row.lud16 : undefined,
    });
  }

  return hits.slice(0, MAX_HITS);
}

/**
 * Searches the directory, or returns nothing.
 *
 * Never throws. A caller is a search box with three other sections in it, and
 * there is no failure here worth turning into an error state — the directory
 * being unreachable and the directory having no matches look the same to
 * somebody typing, and only one of them is worth a sentence.
 */
export async function searchDirectory(
  query: string,
  options: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    /** Overrides the configured directory. For tests, and for a second one. */
    baseUrl?: string;
  } = {}
): Promise<DirectoryHit[]> {
  const term = query.trim();
  const base = options.baseUrl ?? GETZAP_API;
  if (!base || term.length < 2) return [];

  const doFetch = options.fetchImpl ?? fetch;

  try {
    const response = await doFetch(
      `${base}/search?q=${encodeURIComponent(term)}`,
      {
        headers: { Accept: 'application/json' },
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT)])
          : AbortSignal.timeout(TIMEOUT),
      }
    );

    if (!response.ok) return [];

    return parseDirectory(await response.json());
  } catch {
    // Offline, blocked, timed out, or answering something that is not JSON
    return [];
  }
}
