import type { NostrEvent } from '@nostrify/nostrify';
import { nip57, verifyEvent } from 'nostr-tools';
import { ZAP_REQUEST_KIND } from '@/lib/zapRequest';

/** NIP-57 zap receipt. */
export const ZAP_RECEIPT_KIND = 9735;

export interface ParsedZap {
  /**
   * Who actually sent the zap.
   *
   * Not the receipt's `pubkey` — that belongs to the recipient's LNURL server,
   * which signs the receipt on the sender's behalf. Attributing a zap to the
   * receipt author names a payment processor instead of a person.
   */
  senderPubkey: string | null;
  /** Amount in satoshis, or null when no source agrees on one. */
  amountSats: number | null;
  /** The zapper's message, from the zap request. */
  comment: string;
  /** The zapped event, when the zap targeted a note rather than a profile. */
  targetEventId: string | null;
  /** Who was paid. */
  recipientPubkey: string | null;
  /**
   * The invoice that was settled, verbatim.
   *
   * The one field that ties a receipt to a row in a wallet's own ledger. Both
   * sides hold the same bolt11 string, so comparing them says "this zap and
   * this payment are the same event" without decoding anything — which is what
   * stops one arrival of money being announced twice.
   */
  bolt11: string | null;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([tagName]) => tagName === name)?.[1];
}

/**
 * Reads the kind 9734 zap request embedded in a receipt's `description` tag.
 * Returns null when it is absent or malformed, which happens with older or
 * sloppy zapper implementations.
 */
function parseZapRequest(event: NostrEvent): NostrEvent | null {
  const description = tagValue(event, 'description');
  if (!description) return null;

  try {
    const request = JSON.parse(description) as Partial<NostrEvent>;
    if (typeof request?.pubkey !== 'string' || !Array.isArray(request.tags)) {
      return null;
    }
    return request as NostrEvent;
  } catch {
    return null;
  }
}

/** Satoshis from a bolt11 invoice, or null when it can't be read. */
export function satsFromBolt11(invoice: string): number | null {
  try {
    const sats = nip57.getSatoshisAmountFromBolt11(invoice);
    return Number.isFinite(sats) && sats > 0 ? sats : null;
  } catch {
    return null;
  }
}

/**
 * Pulls the human-facing details out of a zap receipt.
 *
 * Amount is taken from the invoice first, because that is the number the
 * sender actually paid; the request's `amount` tag is only what was asked for
 * and the two can disagree.
 */
export function parseZapReceipt(event: NostrEvent): ParsedZap {
  const request = parseZapRequest(event);

  const requestTag = (name: string) =>
    request?.tags.find(([tagName]) => tagName === name)?.[1];

  let amountSats: number | null = null;

  const bolt11 = tagValue(event, 'bolt11');
  if (bolt11) amountSats = satsFromBolt11(bolt11);

  if (amountSats === null) {
    const millisats = Number(requestTag('amount') ?? tagValue(event, 'amount'));
    if (Number.isFinite(millisats) && millisats > 0) {
      amountSats = Math.round(millisats / 1000);
    }
  }

  return {
    // The uppercase P tag is the optional fast path; the request is definitive
    senderPubkey: request?.pubkey ?? tagValue(event, 'P') ?? null,
    amountSats,
    comment: request?.content?.trim() ?? '',
    targetEventId: requestTag('e') ?? tagValue(event, 'e') ?? null,
    recipientPubkey: requestTag('p') ?? tagValue(event, 'p') ?? null,
    bolt11: bolt11 ?? null,
  };
}

/** Compact sat amount, e.g. 1.2k, for use in dense lists. */
export function formatSats(sats: number): string {
  if (sats < 1000) return String(sats);
  if (sats < 1_000_000) {
    const thousands = sats / 1000;
    return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, '') : Math.round(thousands)}k`;
  }
  const millions = sats / 1_000_000;
  return `${millions < 10 ? millions.toFixed(1).replace(/\.0$/, '') : Math.round(millions)}M`;
}


export interface ReceiptCheck {
  /**
   * The recipient the receipt claims to pay.
   *
   * Several are allowed, and mean "any of these". A NIP-75 goal can redirect
   * its money to beneficiaries with `zap` tags, and the receipt then names one
   * of them rather than the goal's author.
   */
  recipientPubkey?: string | string[];
  /**
   * The event it claims to be about, when zapping a note.
   *
   * Also a list, for the same reason in the other direction: a goal announced
   * by a note is funded by zaps naming either, because clients that have never
   * heard of NIP-75 tag the note they can see.
   *
   * An empty list matches nothing — pass `undefined` for "any event".
   */
  eventId?: string | string[];
  /** The coordinate, when zapping an addressable event. */
  address?: string | string[];
  /**
   * The `nostrPubkey` from the recipient's lnurl provider.
   *
   * The only thing that makes a receipt trustworthy: a zap receipt is signed
   * by the recipient's lightning server, and any other key signing one is
   * making it up. Optional here because it costs a request to the recipient's
   * lnurl endpoint, and a total computed without it is still worth more than
   * no total — but it is checked whenever it is known.
   */
  providerPubkey?: string;
}

/**
 * Whether a zap receipt should be believed.
 *
 * Appendix F, plus the checks that follow from a receipt being an ordinary
 * event anybody can publish. Without them a kind 9735 naming any note and any
 * amount is counted, so a stranger can make a post appear to have earned
 * millions of sats — which is exactly what a zap total is used to judge by.
 *
 * The receipt is not proof of payment even when it passes; the NIP is explicit
 * that it only proves somebody fetched an invoice. What these checks buy is
 * that the somebody is the recipient's own lightning server, and that the
 * amount and the target were not altered afterwards.
 */
export function validateZapReceipt(
  event: NostrEvent,
  check: ReceiptCheck = {}
): boolean {
  if (event.kind !== ZAP_RECEIPT_KIND) return false;

  /**
   * "The zap receipt event's pubkey MUST be the same as the recipient's lnurl
   * provider's nostrPubkey." The one check that actually prevents forgery.
   */
  if (check.providerPubkey && event.pubkey !== check.providerPubkey) {
    return false;
  }

  const bolt11 = tagValue(event, 'bolt11');
  const description = tagValue(event, 'description');

  // Both are MUSTs; a receipt without them carries no evidence of anything
  if (!bolt11 || !description) return false;

  const request = parseZapRequest(event);
  if (!request || request.kind !== ZAP_REQUEST_KIND) return false;

  /**
   * The request inside the description is signed by the sender, and that
   * signature is what attributes the zap to them. An invalid one means the
   * receipt names a sender who never asked for it.
   */
  if (!verifyEvent(request as Parameters<typeof verifyEvent>[0])) return false;

  const requestTag = (name: string) =>
    request.tags.find(([tagName]) => tagName === name)?.[1];

  /**
   * "The invoiceAmount contained in the bolt11 tag MUST equal the amount tag
   * of the zap request (if present)." Otherwise a receipt can advertise a
   * large amount while its invoice was for a handful of sats.
   */
  const claimed = Number(requestTag('amount'));

  if (Number.isFinite(claimed) && claimed > 0) {
    const invoiceSats = satsFromBolt11(bolt11);

    /*
     * Only when the invoice actually states an amount. Plenty of real zaps
     * are paid against an amountless invoice — the sum was agreed with the
     * LNURL endpoint rather than written into the bolt11 — and an amount that
     * cannot be read is an unknown, not a mismatch. Rejecting those dropped
     * legitimate zaps silently, which is how a post ends up showing no total
     * while its author is watching the sats arrive.
     */
    if (invoiceSats !== null && Math.round(claimed / 1000) !== invoiceSats) {
      return false;
    }
  }

  /**
   * Matched against every tag of that name, not just the first.
   *
   * A zap request commonly carries several `p` tags — clients copy the
   * mentioned pubkeys from the note being zapped — and several `e` tags, since
   * a reply references its root as well as its parent. Reading only the first
   * meant a zap on any note that mentioned somebody was thrown away.
   */
  const requestHas = (name: string, value: string | string[]) => {
    const wanted = Array.isArray(value) ? value : [value];

    return request.tags.some(
      ([tagName, tagValue]) => tagName === name && wanted.includes(tagValue)
    );
  };

  if (check.recipientPubkey && !requestHas('p', check.recipientPubkey)) {
    return false;
  }

  if (check.address) {
    if (!requestHas('a', check.address)) return false;
  } else if (check.eventId && !requestHas('e', check.eventId)) {
    return false;
  }

  return true;
}
