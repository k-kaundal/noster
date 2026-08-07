import type { NostrEvent } from '@nostrify/nostrify';
import { nip57 } from 'nostr-tools';

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
