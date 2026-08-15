/**
 * Money arriving in the LNbits wallet, announced from the wallet itself.
 *
 * Every other notification in this app is built from a Nostr event, and for
 * incoming money that event is the NIP-57 receipt. Which is fine right up
 * until there isn't one, and there are three ordinary ways there isn't:
 *
 * - **It was not a zap.** Somebody paid the lightning address from a phone
 *   wallet, or scanned an invoice. No zap request exists, so no receipt is
 *   ever written. The sats are simply there, and nothing anywhere says so.
 * - **The receipt went to relays we do not read.** A zapper publishes to the
 *   relays named in the zap *request* — the sender's, not the recipient's — so
 *   whether it reaches you is down to whether your relay list overlaps theirs.
 * - **The receipt has not landed yet.** Publishing happens after settlement
 *   and has to propagate; the wallet already knows.
 *
 * So the wallet's own ledger is read as a second source. It is authoritative
 * about money in a way relays never are — it is the account being paid — and
 * it costs nothing extra, because the balance is already being polled.
 *
 * Nothing here talks to a server. It decides which rows are new and what to
 * say about them, which is the part worth testing.
 */

import { msatToSat, paymentTimeMs, type LnbitsPayment } from '@/lib/lnbits';

/** One arrival, reduced to what a notification needs. */
export interface IncomingPayment {
  /** LNbits' own id for the row, unique per payment. */
  checkingId: string;
  amountSats: number;
  /** Whatever the payer attached — an LNURL comment, or the invoice memo. */
  memo: string;
  timeMs: number;
  /** The invoice, for matching against a zap receipt that says the same thing. */
  bolt11: string;
}

/** Whether a row is settled money coming in, rather than going out or pending. */
function isIncoming(payment: LnbitsPayment): boolean {
  /*
   * LNbits signs the amount by direction — outgoing rows are negative — and
   * has reported settlement as both `status: "success"` and a `paid` flag
   * depending on version. A pending incoming payment is money that has not
   * arrived, and announcing it would be announcing something that can still
   * fail.
   */
  const settled =
    payment.status === 'success' ||
    (payment as { paid?: boolean }).paid === true;

  return settled && payment.amount > 0;
}

/**
 * Arrivals after a moment, newest first.
 *
 * Bounded by time rather than by a cursor because the ledger is a window: rows
 * fall off the end of `limit`, and a cursor into one that has scrolled away
 * would replay everything still visible.
 */
export function incomingSince(
  payments: LnbitsPayment[],
  sinceMs: number
): IncomingPayment[] {
  return payments
    .filter(isIncoming)
    .map((payment) => ({
      checkingId: payment.checking_id || payment.payment_hash,
      amountSats: msatToSat(payment.amount),
      memo: (payment.memo ?? '').trim(),
      timeMs: paymentTimeMs(payment.time),
      bolt11: payment.bolt11 ?? '',
    }))
    /*
     * A row with no usable timestamp is dropped rather than treated as new.
     * `paymentTimeMs` answers 0 for one it cannot read, and 0 is older than
     * every marker — so the alternative reading would announce it on every
     * poll, forever.
     */
    .filter((payment) => payment.timeMs > sinceMs)
    .sort((a, b) => b.timeMs - a.timeMs);
}

/**
 * Drops arrivals a zap receipt already accounted for.
 *
 * The receipt and the ledger row hold the same bolt11 string — one is the
 * invoice the zapper paid, the other is the invoice the wallet settled — so
 * matching them exactly says "these are one event" without decoding anything
 * or guessing from amounts and timestamps.
 *
 * Which matters because the receipt is the better notification of the two: it
 * knows who sent it and what they wrote. This is the fallback, and a fallback
 * that fires alongside the thing it backs up is just a duplicate.
 */
export function withoutZapped(
  payments: IncomingPayment[],
  zappedInvoices: Iterable<string>
): IncomingPayment[] {
  const zapped = new Set(
    [...zappedInvoices]
      .filter(Boolean)
      .map((invoice) => invoice.trim().toLowerCase())
  );

  if (!zapped.size) return payments;

  return payments.filter(
    (payment) => !zapped.has(payment.bolt11.trim().toLowerCase())
  );
}

/** The newest timestamp in a ledger, or the fallback when it holds nothing. */
export function newestArrival(
  payments: LnbitsPayment[],
  fallbackMs: number
): number {
  let newest = fallbackMs;

  for (const payment of payments) {
    if (!isIncoming(payment)) continue;

    const time = paymentTimeMs(payment.time);
    if (time > newest) newest = time;
  }

  return newest;
}

/** What to put on the notification. */
export function describeIncoming(payment: IncomingPayment): {
  title: string;
  body: string;
} {
  return {
    title: `⚡ ${payment.amountSats.toLocaleString()} sats received`,
    /*
     * The memo when there is one. LNbits writes its own description into rows
     * it created — "NostrFeed", or the pay link's description — and repeating
     * that back says nothing the title did not, so it is treated as absent.
     */
    body:
      payment.memo && !/^(nostrfeed|zap .* on nostrfeed)$/i.test(payment.memo)
        ? payment.memo
        : 'Landed in your NostrFeed wallet.',
  };
}
