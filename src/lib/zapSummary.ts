/**
 * What a note earned, and from whom.
 *
 * The zap button on a post showed a bolt and nothing else, while reply, repost
 * and like all carried counts — so the one action that moves money was the one
 * with no evidence that it ever had. The receipts were already being fetched
 * for every visible note; nothing read them.
 *
 * The number this produces is the number readers judge a post by, which is
 * exactly why it cannot be taken at face value. A kind 9735 is an ordinary
 * event: anybody can publish one naming any note and any amount. So every
 * receipt goes through `validateZapReceipt` first, and what survives is a
 * total somebody's lightning server actually signed for.
 */
import type { NostrEvent } from '@nostrify/nostrify';
import { parseZapReceipt, validateZapReceipt } from '@/lib/zap';

export interface Zapper {
  /** The receipt, for keys and for pointing at the evidence. */
  receiptId: string;
  /** Who sent it, from the signed request rather than the receipt author. */
  pubkey: string;
  sats: number;
  /** What they wrote with it, which is half the point of a zap. */
  comment: string;
  at: number;
}

export interface ZapSummary {
  totalSats: number;
  /** Distinct receipts, not distinct people: two zaps from one person are two. */
  count: number;
  /** Largest first — the list is read to see who gave most. */
  zappers: Zapper[];
}

export const EMPTY_ZAP_SUMMARY: ZapSummary = {
  totalSats: 0,
  count: 0,
  zappers: [],
};

export interface ZapSummaryOptions {
  /** The note the receipts must be about. */
  eventId: string;
  /** Its author, who must be the one the payment named. */
  recipientPubkey: string;
  /**
   * The recipient's lnurl provider key, when it is known.
   *
   * The only check that actually prevents forgery, and the only one that
   * costs a request — so it is optional, and applied whenever it is known.
   * Without it the total is still worth more than no total, because every
   * other check has already been made.
   */
  providerPubkey?: string;
}

/**
 * Adds up the receipts that survive checking.
 *
 * Deduplicated on the receipt id, because the same receipt arrives from every
 * relay that holds it and a total counted per copy is a total multiplied by
 * however many relays somebody happens to read from.
 */
export function summarizeZaps(
  receipts: NostrEvent[],
  options: ZapSummaryOptions
): ZapSummary {
  const seen = new Set<string>();
  const zappers: Zapper[] = [];
  let totalSats = 0;

  for (const receipt of receipts) {
    if (seen.has(receipt.id)) continue;

    const valid = validateZapReceipt(receipt, {
      eventId: options.eventId,
      recipientPubkey: options.recipientPubkey,
      providerPubkey: options.providerPubkey,
    });
    if (!valid) continue;

    const parsed = parseZapReceipt(receipt);

    // A receipt with no readable amount adds nothing and names nobody
    if (parsed.amountSats === null || parsed.amountSats <= 0) continue;
    if (!parsed.senderPubkey) continue;

    seen.add(receipt.id);
    totalSats += parsed.amountSats;

    zappers.push({
      receiptId: receipt.id,
      pubkey: parsed.senderPubkey,
      sats: parsed.amountSats,
      comment: parsed.comment,
      at: receipt.created_at,
    });
  }

  zappers.sort((a, b) => b.sats - a.sats || b.at - a.at);

  return { totalSats, count: zappers.length, zappers };
}

/**
 * The line under the total: "3,420 sats · 12 zaps".
 *
 * Both numbers, because they answer different questions — one big zap and
 * twelve small ones say very different things about a post, and a total alone
 * cannot tell them apart.
 */
export function describeZapSummary(summary: ZapSummary): string {
  const zaps = summary.count === 1 ? '1 zap' : `${summary.count} zaps`;
  return `${summary.totalSats.toLocaleString()} sats · ${zaps}`;
}
