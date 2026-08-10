import { normalizeRelayUrl } from '@/lib/relay';

/**
 * Relays that index identity for the whole network.
 *
 * Profiles are the one thing a general relay is reliably wrong about. Someone
 * who signed up on another client publishes their kind 0 to their own relays;
 * ours may hold nothing, or a copy from years ago that some other client
 * wrote — and since kind 0 is replaceable, whichever revision a relay happens
 * to have is the one it serves forever. The result is a real person shown
 * under a stale name and a missing avatar, or worse, under someone else's
 * older data for the same key.
 *
 * These two relays exist to solve exactly that: they index kind 0 and kind
 * 10002 across the network, and asking them is the accepted fix rather than
 * routing every profile lookup through its author's own relays. Two extra
 * connections, only for identity lookups.
 */
export const INDEXER_RELAYS = [
  'wss://purplepag.es',
  'wss://relay.nostr.band',
];

/** Profile metadata and relay lists — the kinds worth asking an indexer for. */
const INDEXED_KINDS = new Set([0, 10002]);

/**
 * Whether a request is asking about who someone is.
 *
 * `every` rather than `some`: a timeline asking for notes alongside metadata
 * should not drag two more relays into every page of the feed. Only a request
 * that is *entirely* about identity qualifies.
 */
export function isIdentityRequest(
  filters: Array<{ kinds?: number[] }>
): boolean {
  if (!filters.length) return false;

  return filters.every(
    (filter) =>
      !!filter.kinds?.length &&
      filter.kinds.every((kind) => INDEXED_KINDS.has(kind))
  );
}

/**
 * Canonical, deduplicated relay targets.
 *
 * The pool keys its connections by the exact string it is handed, so
 * `wss://nos.lol` and `wss://nos.lol/` are two websockets to one relay — and
 * every query and publish then goes out twice. Config is normalized on load,
 * but this is the last point before a socket is opened, so it is normalized
 * here too rather than trusting whatever reached it.
 */
export function canonicalTargets(urls: string[]): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];

  for (const url of urls) {
    const normalized = normalizeRelayUrl(url);
    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    targets.push(normalized);
  }

  return targets;
}

/**
 * Puts the primary relay at the head of the list, and guarantees it is in the
 * list at all.
 *
 * Both relay routers truncate to a cap, so ordering decides who gets dropped.
 * The primary is the one relay that must never be truncated away — without
 * this it would fall off simply by sitting late in the user's configured list.
 */
export function withPrimaryFirst(urls: string[], primary: string): string[] {
  const unique = canonicalTargets(urls);
  const head = normalizeRelayUrl(primary);
  if (!head) return unique;

  return [head, ...unique.filter((url) => url !== head)];
}
