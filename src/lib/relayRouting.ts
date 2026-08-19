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

/** NIP-57 zap receipt. */
const ZAP_RECEIPT_KIND = 9735;

/**
 * Relays worth asking about money you were paid.
 *
 * Zap receipts are the one thing outbox routing cannot help with. NIP-65 sends
 * a request for someone's events to the relays *they* publish to — but a
 * receipt is not published by you or by the sender. It is published by the
 * sender's lightning server, to the relays named in the `relays` tag of the
 * zap request, which is the sender's client's list and nobody else's.
 *
 * So a zap from Damus lands on Damus's relays. If none of them are in your
 * list, the money arrived and the receipt is somewhere you never look — and no
 * amount of routing by author fixes it, because the filter names no author to
 * route by.
 *
 * These are the default write relays of the largest clients, which is to say
 * the places most zap requests name. Asked only for requests that are entirely
 * about receipts, so a feed does not drag them into every page.
 */
export const RECEIPT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

/**
 * Whether a request is asking only about zap receipts.
 *
 * `every`, for the same reason as `isIdentityRequest`: `useNoteStats` fetches
 * replies, reposts, reactions and receipts in one filter per screenful, and
 * widening that would put four more relays behind every feed page. Only a
 * request that is purely about receipts — an earnings total, a goal tally —
 * pays for the wider net.
 */
export function isZapReceiptRequest(
  filters: Array<{ kinds?: number[] }>
): boolean {
  if (!filters.length) return false;

  return filters.every(
    (filter) =>
      filter.kinds?.length === 1 && filter.kinds[0] === ZAP_RECEIPT_KIND
  );
}

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
