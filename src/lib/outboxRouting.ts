import type { NostrEvent } from '@nostrify/nostrify';
import { fromRelayListTags, writeRelays } from '@/lib/relay';
import { canonicalTargets } from '@/lib/relayRouting';

/**
 * Reading people where they actually publish.
 *
 * Until now every read went to the relay set *the reader* configured. That is
 * the centralized shape wearing decentralized clothes: you see what your
 * relays happened to keep, so the app is only as complete as its own relay,
 * and somebody who publishes to their own two relays is invisible here no
 * matter how correctly they followed the protocol.
 *
 * NIP-65 is the answer the network settled on. Everyone announces where they
 * write; to read them, you ask *there*. The consequence is that no relay in
 * the list — including ours — is load-bearing any more. Turn ours off and the
 * app keeps working, because it was never the source of anything.
 *
 * The table is filled from kind 10002 events as they pass through the pool,
 * so it costs no extra requests: every profile view, every relay-list lookup,
 * every feed that happens to carry one makes the next read better routed.
 */

/** Where the harvested relay lists are kept between visits. */
export const RELAY_LIST_SCOPE = 'relay-lists';

/** NIP-65 relay list metadata. */
export const RELAY_LIST_KIND = 10002;

/**
 * Slots held open for the authors being asked about.
 *
 * Deliberately a reservation inside the existing budget rather than an
 * addition to it. Routing must not quietly turn ten websockets into fourteen
 * on a phone — the point is to ask better relays, not more of them.
 */
export const RESERVED_FOR_AUTHORS = 3;

/** pubkey -> the relays that author publishes to, newest list wins. */
const table = new Map<string, { relays: string[]; at: number }>();

/**
 * The authors a set of filters is asking about.
 *
 * Empty unless *every* filter names authors: a request that is partly an
 * author lookup and partly an open subscription still needs the general
 * relays, and routing it as though it were narrow would silently drop half
 * of what it asked for.
 */
export function authorsIn(
  filters: Array<{ authors?: string[] }>
): string[] {
  if (!filters.length) return [];
  if (!filters.every((filter) => filter.authors?.length)) return [];

  return [...new Set(filters.flatMap((filter) => filter.authors ?? []))];
}

/**
 * Records where these authors publish.
 *
 * Ignores anything that is not a relay list, so this can be handed every event
 * the pool sees without the caller filtering first. Returns whether anything
 * changed, so a caller can skip a write when nothing did.
 */
export function rememberRelayLists(events: readonly NostrEvent[]): boolean {
  let changed = false;

  for (const event of events) {
    if (event.kind !== RELAY_LIST_KIND) continue;

    const held = table.get(event.pubkey);
    // Replaceable: an older list reaching us later says nothing new
    if (held && held.at >= event.created_at) continue;

    const relays = canonicalTargets(writeRelays(fromRelayListTags(event.tags)));
    if (!relays.length) continue;

    table.set(event.pubkey, { relays, at: event.created_at });
    changed = true;
  }

  return changed;
}

/** Every relay list currently known, for storing. */
export function knownRelayLists(): Map<string, { relays: string[]; at: number }> {
  return new Map(table);
}

/** How many authors we can route for. Surfaced so the UI can say. */
export function routableAuthors(): number {
  return table.size;
}

/**
 * Where these authors publish, most widely used first.
 *
 * Ordered by how many of the authors share a relay, because a query goes to
 * all of the chosen relays at once: one relay covering four of the five
 * authors is worth more than four relays covering one each, and the budget is
 * small enough that the difference decides who gets read at all.
 */
export function relayHintsFor(pubkeys: readonly string[]): string[] {
  const votes = new Map<string, number>();

  for (const pubkey of pubkeys) {
    const held = table.get(pubkey);
    if (!held) continue;

    for (const relay of held.relays) {
      votes.set(relay, (votes.get(relay) ?? 0) + 1);
    }
  }

  return [...votes.entries()]
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      // Stable across devices holding the same table
      return a[0] < b[0] ? -1 : 1;
    })
    .map(([relay]) => relay);
}

/**
 * The relays to actually query: the reader's own, with room made for the
 * authors'.
 *
 * The reader's relays are never dropped to nothing. An author's published list
 * can be stale, wrong, or point at relays that have been gone for a year —
 * trusting it exclusively would mean a bad relay list makes somebody
 * unreadable, which is a worse failure than the one this fixes.
 */
export function withAuthorHints(
  base: readonly string[],
  hints: readonly string[],
  total: number,
  reserved = RESERVED_FOR_AUTHORS
): string[] {
  const held = new Set(base);
  const fresh = hints.filter((relay) => !held.has(relay));

  if (!fresh.length) return base.slice(0, total);

  const taken = fresh.slice(0, Math.min(reserved, Math.max(total - 1, 0)));

  return [...base.slice(0, Math.max(total - taken.length, 0)), ...taken];
}

/** Rebuilds the table from stored relay lists, at startup. */
export function primeOutboxTable(events: readonly NostrEvent[]): void {
  rememberRelayLists(events);
}

/** Empties the table. For sign-out, and for tests sharing a module instance. */
export function resetOutboxTable(): void {
  table.clear();
}
