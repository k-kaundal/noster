import { ADDRESS_DOMAINS } from '@/lib/lightningAddress';
import { NIP5_DOMAINS } from '@/lib/nip5';

/**
 * Turning `@alice` back into a public key.
 *
 * An `npub` is not shareable anywhere that people actually are. Nobody puts
 * `npub1qqs...` in a bio on another site, reads one out, or types one from a
 * business card — so the only address this app could hand somebody was one
 * they could not use, and every profile link out of Nostr was a dead end.
 *
 * NIP-05 already solves it. The spec is explicit that the point is discovery
 * from a human-readable identifier, not a verification badge: a domain serves
 * `/.well-known/nostr.json?name=<local>` and answers with the key. That makes
 * `/@alice` a real, typeable, quotable address for a profile.
 *
 * What this must never do is decide that somebody *is* who the name says.
 * The domain is authoritative for its own names and nothing else — a kind 0
 * claiming `alice@example.com` proves nothing until example.com agrees, and
 * that check belongs to whatever draws the badge, not here.
 */

export interface Handle {
  /** The local part, lowercased. */
  name: string;
  /** The domain, when the address named one. */
  domain?: string;
}

/**
 * Reads `@alice` or `@alice@getzap.me` out of a URL segment.
 *
 * Returns null for anything that is not one, so an ordinary NIP-19 identifier
 * falls through to the code that understands it rather than being resolved as
 * a name that will never exist.
 */
export function parseHandle(segment: string | undefined): Handle | null {
  if (!segment || !segment.startsWith('@')) return null;

  const body = segment.slice(1).trim().toLowerCase();
  if (!body) return null;

  const parts = body.split('@');
  if (parts.length > 2) return null;

  const [name, domain] = parts;

  /**
   * NIP-05: "the `<local-part>` is restricted to `a-z0-9-_.`". Enforced rather
   * than passed through, because this becomes a query string on somebody
   * else's server and a segment that can hold a slash or a `?` is a segment
   * that can point the lookup somewhere else entirely.
   */
  if (!/^[a-z0-9\-_.]+$/.test(name)) return null;

  if (domain !== undefined) {
    if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes('.')) return null;
    return { name, domain };
  }

  return { name };
}

/** The `@handle` form of an address, for links and for showing. */
export function formatHandle(handle: Handle): string {
  return handle.domain ? `@${handle.name}@${handle.domain}` : `@${handle.name}`;
}

/**
 * The domains a bare `@alice` is looked for on, in order.
 *
 * This instance's own, since a name with no domain is a claim about being
 * from here. Identity domains come first — a NIP-05 domain is what a name
 * means — with the lightning domains after, because the two lists are
 * configured separately and are not guaranteed to agree.
 */
export function localDomains(): string[] {
  return [
    ...new Set(
      [...NIP5_DOMAINS.map((entry) => entry.domain), ...ADDRESS_DOMAINS].filter(
        (domain): domain is string => !!domain
      )
    ),
  ];
}

/**
 * The path to share for a profile.
 *
 * `/@alice` when their name is on one of this instance's domains, the full
 * `/@alice@elsewhere.com` when it is not, and the `npub` when they have no
 * name — which is the case this exists to improve, not to hide. Somebody
 * without a NIP-05 still gets a working link; it is just not one they can
 * read out.
 */
export function profilePath(
  nip05: string | undefined,
  npub: string,
  ours: string[] = localDomains()
): string {
  const parsed = parseHandle(nip05 ? `@${nip05}` : undefined);

  /*
   * NIP-05 gives `_` the meaning "the domain itself", so `_@example.com` is
   * displayed as `example.com` and is not a name anybody can type back. The
   * key is the better link for those.
   */
  if (!parsed?.domain || parsed.name === '_') return `/${npub}`;

  return ours.includes(parsed.domain)
    ? `/@${parsed.name}`
    : `/@${parsed.name}@${parsed.domain}`;
}

/** Where a name is looked up, per NIP-05. */
export function nip05Url(name: string, domain: string): string {
  return `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(
    name
  )}`;
}

/** A 32-byte key in hex, which is the only thing a `names` entry may be. */
function isPubkey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/**
 * The key a domain gives for a name, or null.
 *
 * Matched case-insensitively on the way in but read from the document as
 * served: NIP-05 local parts are lowercase by specification, and plenty of
 * real files nonetheless key them as somebody typed them.
 */
export function readNip05Pubkey(body: unknown, name: string): string | null {
  if (!body || typeof body !== 'object') return null;

  const names = (body as { names?: unknown }).names;
  if (!names || typeof names !== 'object') return null;

  const wanted = name.toLowerCase();

  for (const [key, value] of Object.entries(names as Record<string, unknown>)) {
    if (key.toLowerCase() !== wanted) continue;
    if (isPubkey(value)) return value.toLowerCase();
  }

  return null;
}

/**
 * The relay hints a domain publishes for a key.
 *
 * Optional in NIP-05 and worth taking when it is there: somebody arriving by
 * name has no relay context at all, and their notes are on the relays their
 * own domain names rather than necessarily on ours.
 */
export function readNip05Relays(body: unknown, pubkey: string): string[] {
  if (!body || typeof body !== 'object') return [];

  const relays = (body as { relays?: unknown }).relays;
  if (!relays || typeof relays !== 'object') return [];

  const found = (relays as Record<string, unknown>)[pubkey];
  if (!Array.isArray(found)) return [];

  return found.filter(
    (url): url is string =>
      typeof url === 'string' && /^wss?:\/\//i.test(url)
  );
}
