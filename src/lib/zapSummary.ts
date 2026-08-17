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
import { parseZapReceipt, explainZapReceipt, type ReceiptRejection } from '@/lib/zap';

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
  /**
   * Receipts that arrived and were not counted, with the check each failed.
   *
   * The number people actually ask about is this one: "I paid and it is not
   * showing." Without it the only honest answer was that something, somewhere,
   * decided not to count it.
   */
  rejected: { id: string; reason: ReceiptRejection }[];
}

export const EMPTY_ZAP_SUMMARY: ZapSummary = {
  totalSats: 0,
  count: 0,
  zappers: [],
  rejected: [],
};

export interface ZapSummaryOptions {
  /**
   * The note the receipts must be about.
   *
   * Left undefined for an addressable event, which is referenced by
   * coordinate instead — see `address`.
   *
   * More than one is allowed, and means "any of these". A NIP-75 goal
   * announced by a note counts zaps naming either: the `goal` tag is the
   * author saying zaps on that note are for this goal, and a client that has
   * never heard of NIP-75 can only tag the note it is looking at.
   */
  eventId?: string | string[];
  /**
   * `30023:<pubkey>:<d>` for an addressable event.
   *
   * An article's zaps carry an `a` tag and often no `e` tag at all, so
   * checking them against an event id rejects every one of them.
   */
  address?: string;
  /**
   * Who the payment must have named.
   *
   * A list, because a payment can legitimately name one of several people: a
   * NIP-75 goal may carry `zap` tags redirecting the money to beneficiaries,
   * so a receipt naming one of those is as valid as one naming the author.
   * Checking against the author alone rejected every zap to such a goal and
   * left it reading zero.
   */
  recipientPubkey: string | string[];
  /**
   * Count only zaps on the person, not on anything they published.
   *
   * What a profile page shows. A profile zap carries a `p` tag and no `e` or
   * `a` — see `validateZapReceipt` — so it matches no note id, and every one
   * ever sent from a profile page was falling through this function's checks
   * unnoticed while the page beside it read zero.
   */
  profileOnly?: boolean;
  /**
   * The recipient's lnurl provider key, when it is known.
   *
   * The only check that actually prevents forgery, and the only one that
   * costs a request — so it is optional, and applied whenever it is known.
   * Without it the total is still worth more than no total, because every
   * other check has already been made.
   */
  providerPubkey?: string | string[];
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
  const rejected: { id: string; reason: ReceiptRejection }[] = [];
  let totalSats = 0;

  for (const receipt of receipts) {
    if (seen.has(receipt.id)) continue;

    /*
     * One check per receipt, whatever the number of candidates. This used to
     * loop, calling `validateZapReceipt` once per acceptable recipient — and
     * every one of those calls verifies a signature, so a goal with three
     * beneficiaries verified every receipt four times over.
     */
    const rejection = explainZapReceipt(receipt, {
      // One or the other: an addressable event is named by its coordinate
      eventId: options.address ? undefined : options.eventId,
      address: options.address,
      profileOnly: options.profileOnly,
      recipientPubkey: options.recipientPubkey,
      providerPubkey: options.providerPubkey,
    });
    if (rejection) {
      /*
       * Recorded rather than dropped. A zap that does not appear is a payment
       * somebody made and cannot find, and a silent `continue` is why that was
       * only ever diagnosable by guessing.
       */
      rejected.push({ id: receipt.id, reason: rejection });
      continue;
    }

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

  return { totalSats, count: zappers.length, zappers, rejected };
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
