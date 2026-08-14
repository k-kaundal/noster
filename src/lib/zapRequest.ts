import { bech32 } from '@scure/base';
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Building a NIP-57 zap, up to the point where an invoice exists.
 *
 * Written out rather than delegated to a wallet library because every library
 * that does this end to end also insists on paying it, through `window.webln`.
 * That made a browser extension the only way to zap anything here: the
 * custodial wallet this app hands out, and any NWC wallet someone connected,
 * were both ignored.
 *
 * Splitting it means the invoice is produced here and paid by whichever wallet
 * the person picked — which is the whole point of having more than one.
 */

/** NIP-57 zap request. Signed by the sender, handed to the recipient's server. */
export const ZAP_REQUEST_KIND = 9734;

/**
 * How many relays to name in the request.
 *
 * These are where the recipient's server will publish the receipt. Naming the
 * reader's entire relay list makes a URL some LNURL servers reject outright.
 */
export const MAX_ZAP_RELAYS = 6;

/**
 * The lnurlp URL a lightning address resolves to (LUD-16).
 *
 * Returns null for anything that is not an address, so a malformed `lud16` in
 * someone's profile fails here with a clear message instead of producing a
 * request to a URL built out of nonsense.
 */
export function lightningAddressUrl(address: string): string | null {
  const match = /^([^\s@/]+)@([^\s@/]+)$/.exec(address.trim());
  if (!match) return null;

  const [, name, domain] = match;
  if (!/^[a-z0-9._-]+$/i.test(name)) return null;
  if (!/^[a-z0-9.-]+$/i.test(domain) || !domain.includes('.')) return null;

  // LUD-16: onion hosts are served over http, everything else over https
  const scheme = domain.endsWith('.onion') ? 'http' : 'https';

  return `${scheme}://${domain}/.well-known/lnurlp/${name}`;
}

/**
 * A pay endpoint as the bech32 `lnurl` string NIP-57 asks for.
 *
 * Appendix A recommends it as a tag on the request and Appendix B as a query
 * parameter on the callback; Appendix F has receivers check that it matches.
 * We were sending neither, which is legal but leaves the recipient's server
 * one fewer way to tell that the request it was handed is about itself — and
 * some of them care.
 *
 * Returns null rather than throwing on a URL bech32 cannot carry, because a
 * zap that goes out without an optional tag is better than one that does not
 * go out.
 */
export function lnurlEncode(url: string): string | null {
  try {
    const words = bech32.toWords(new TextEncoder().encode(url));
    // The default 90-character limit is for addresses; an lnurl is far longer
    return bech32.encode('lnurl', words, 1023);
  } catch {
    return null;
  }
}

/** The coordinate of an addressable event, which zaps reference with `a`. */
export function addressPointerFor(event: NostrEvent): string | null {
  if (event.kind < 30000 || event.kind >= 40000) return null;

  const identifier = event.tags.find(([name]) => name === 'd')?.[1] ?? '';

  return `${event.kind}:${event.pubkey}:${identifier}`;
}

export interface ZapRequestInput {
  /** Who is being paid. */
  recipientPubkey: string;
  amountMsat: number;
  /** Where the recipient's server should publish the receipt. */
  relays: string[];
  /**
   * Relays that must appear whatever the cap says — a zap goal's `relays`
   * tag, which is where its tally is read from.
   */
  requiredRelays?: string[];
  /** The zapper's message. NIP-57 carries it as the request's content. */
  comment?: string;
  /** The note being zapped. Omitted when zapping a profile. */
  eventId?: string;
  /** Coordinates of an addressable event — an article, say — instead of `e`. */
  addressPointer?: string;
  /** Kind of the thing being zapped, for the `k` tag. */
  targetKind?: number;
  /**
   * A NIP-75 goal this zap should count toward, from the target's `goal` tag.
   * Tagged in addition to the target, not instead of it.
   */
  goalEventId?: string;
  /** The recipient's bech32 LNURL, when it is known. */
  lnurl?: string;
  createdAt?: number;
}

/** The unsigned kind 9734 the sender signs. */
export function buildZapRequest(input: ZapRequestInput) {
  const usable = input.relays.filter(
    (url) => url.startsWith('wss://') || url.startsWith('ws://')
  );

  /**
   * NIP-75 makes naming a goal's relays a MUST, and the cap above would
   * quietly break it — the reader's own relays come first in the list, so a
   * goal naming three would lose them to a wallet's worth of general relays.
   * Anything required is kept whole and the cap applies to the rest.
   */
  const required = (input.requiredRelays ?? []).filter(
    (url) => url.startsWith('wss://') || url.startsWith('ws://')
  );

  const relays = [
    ...new Set([...required, ...usable.slice(0, MAX_ZAP_RELAYS)]),
  ];

  const tags: string[][] = [
    ['relays', ...relays],
    ['amount', String(Math.round(input.amountMsat))],
    ['p', input.recipientPubkey],
  ];

  if (input.lnurl) tags.push(['lnurl', input.lnurl]);

  // A note zap carries `e`; an article zap carries `a`. Sending both would
  // have the receipt attach itself to two different things
  if (input.addressPointer) {
    tags.push(['a', input.addressPointer]);
  } else if (input.eventId) {
    tags.push(['e', input.eventId]);
  }

  /**
   * "`k` is the stringified kind of the target event." Lets a recipient's
   * server and anyone reading the receipt tell what was zapped without
   * fetching it — a note, an article, a goal.
   */
  if (input.targetKind !== undefined && (input.addressPointer || input.eventId)) {
    tags.push(['k', String(input.targetKind)]);
  }

  /**
   * The goal, but only when nothing else has claimed the `e` tag.
   *
   * NIP-75: "When zapping an addressable event with a `goal` tag, clients
   * SHOULD tag the goal event id in the `e` tag of the zap request." That case
   * is safe — an addressable target is named by `a`, so the goal is the only
   * `e` there is.
   *
   * A plain note linking a goal is not safe, and this used to emit both. NIP-57
   * Appendix D is a validation rule servers are told to apply: a zap request
   * "MUST have 0 or 1 `e` tags". Two of them is a request a conforming LNURL
   * server is entitled to refuse outright, which turns "fund this goal" into a
   * zap that never happens.
   *
   * Nothing is lost by naming only the note: `useZapGoal` counts receipts on
   * the announcing event toward the goal precisely because other clients can
   * only ever tag the note they can see.
   */
  const hasEventTag = tags.some(([name]) => name === 'e');

  if (input.goalEventId && !hasEventTag) {
    tags.push(['e', input.goalEventId]);
  }

  return {
    kind: ZAP_REQUEST_KIND,
    content: input.comment?.trim() ?? '',
    tags,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
  };
}

/**
 * The callback URL that turns a signed zap request into an invoice.
 *
 * The callback may already carry query parameters — LNbits' does — so these
 * are appended rather than assumed to be the first, which is the difference
 * between a working URL and one with two question marks in it.
 */
export function zapCallbackUrl(
  callback: string,
  amountMsat: number,
  signedRequest: NostrEvent,
  lnurl?: string
): string {
  const url = new URL(callback);

  url.searchParams.set('amount', String(Math.round(amountMsat)));
  url.searchParams.set('nostr', JSON.stringify(signedRequest));
  if (lnurl) url.searchParams.set('lnurl', lnurl);

  return url.toString();
}

/**
 * Why a zap can't be sent to this profile, or null when it can.
 *
 * Checked before anything is signed, so nobody is asked to approve a request
 * for a payment that was never going to work.
 */
export function describeZapTarget(metadata: {
  lud16?: string;
  lud06?: string;
}): string | null {
  const address = metadata.lud16 ?? metadata.lud06;

  if (!address) {
    return "They haven't set up a lightning address, so there's nowhere to send it.";
  }

  if (metadata.lud16 && !lightningAddressUrl(metadata.lud16)) {
    return `Their lightning address (${metadata.lud16}) isn't a valid one.`;
  }

  return null;
}
