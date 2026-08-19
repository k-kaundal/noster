/**
 * What actually landed in the wallet, and what it was for.
 *
 * The other half of Studio. That page counts zap receipts found on relays,
 * which is the only way to see money paid to a lightning address this app does
 * not hold — and it is structurally incomplete, because a receipt is published
 * by the *sender's* server to the relays the *sender's* client chose.
 *
 * This half comes from the wallet's own ledger, which has the opposite
 * properties: complete and authoritative for money that arrived here, and
 * blind to everything paid anywhere else. Neither figure is "total earnings",
 * and adding them would double-count every zap that landed in this wallet.
 * They are shown as two readings of the same business, with the overlap named.
 *
 * Everything here is a pure function of a payment list so the arithmetic can
 * be checked without a wallet.
 */
import { msatToSat, paymentTimeMs, type LnbitsPayment } from '@/lib/lnbits';

/** One line of the breakdown: a place money came from. */
export interface RevenueSource {
  /** The LNbits tag, or `direct` for payments no extension claimed. */
  id: string;
  label: string;
  sats: number;
  count: number;
}

export interface RevenueSummary {
  /** Settled incoming sats inside the window. */
  sats: number;
  count: number;
  /**
   * The part that arrived as a Nostr zap, and so also appears in the relay
   * figure. The one number that makes the two halves comparable rather than
   * addable.
   */
  zapSats: number;
  zapCount: number;
  /** The rest: money the relays never saw. */
  otherSats: number;
  /** Biggest first. */
  bySource: RevenueSource[];
  /** Percent against the previous window of equal length; null with no history. */
  change: number | null;
}

export const EMPTY_REVENUE: RevenueSummary = {
  sats: 0,
  count: 0,
  zapSats: 0,
  zapCount: 0,
  otherSats: 0,
  bySource: [],
  change: null,
};

/**
 * What each extension sells, in the words a creator would use.
 *
 * Keyed on the LNbits tag. An unknown tag keeps its own name rather than being
 * bucketed into "other" — a deployment that installs something new should see
 * it appear, not disappear.
 */
const LABELS: Record<string, string> = {
  lnurlp: 'Lightning address',
  nostrnip5: 'Names',
  tipjar: 'Tips',
  events: 'Tickets',
  lnticket: 'Tickets',
  nostrmarket: 'Marketplace',
  orders: 'Orders',
  sellcoins: 'Sales',
  tpos: 'Point of sale',
  paywall: 'Paywalled posts',
  invoices: 'Invoices',
  scrum: 'Task rewards',
  satspay: 'Charges',
  withdraw: 'Withdraw links',
  boltcards: 'Cards',
  livestream: 'Livestream',
};

/** The bucket for money that arrived on a plain invoice. */
const DIRECT = 'direct';

export function describeRevenueSource(id: string): string {
  if (id === DIRECT) return 'Direct invoices';
  return LABELS[id] ?? id;
}

/** Which bucket a payment belongs to. */
export function revenueSourceId(payment: LnbitsPayment): string {
  const tag = (payment.tag || payment.extension || '').trim().toLowerCase();
  return tag || DIRECT;
}

/**
 * Money in, and settled.
 *
 * Outgoing payments are negative in LNbits, and pending ones may never
 * complete — counting either would make this a number that goes down.
 */
export function isRevenue(payment: LnbitsPayment): boolean {
  return payment.amount > 0 && payment.status === 'success';
}

/**
 * Whether this payment came from a Nostr zap.
 *
 * LNbits stores the zap request on the payment when a NIP-57 callback carried
 * one, so its presence is proof. Its absence is only the absence of proof —
 * an older LNbits, or an extension that does not forward it, looks the same as
 * a plain invoice. Read the other way round it would overstate the overlap and
 * understate what the relays are missing, which is the direction that matters
 * here, so this errs toward "not a zap".
 */
export function isZapPayment(payment: LnbitsPayment): boolean {
  const nostr = payment.extra?.nostr;
  if (typeof nostr === 'string') return nostr.trim().length > 0;
  return !!nostr && typeof nostr === 'object';
}

/** Sats for a payment, from the millisatoshi figure LNbits reports. */
function sats(payment: LnbitsPayment): number {
  return msatToSat(payment.amount);
}

/**
 * The window's takings, split by what they were for.
 *
 * The previous window is measured from the same list, so the comparison is
 * only as honest as how far back the list reaches — a caller that fetched one
 * page of payments will see a change figure against a partial past. Callers
 * say how many payments they asked for; see `useCreatorRevenue`.
 */
export function summarizeRevenue(
  payments: LnbitsPayment[],
  windowDays: number,
  now = Date.now()
): RevenueSummary {
  const span = windowDays * 86_400_000;
  const from = now - span;
  const previousFrom = from - span;

  const buckets = new Map<string, RevenueSource>();
  let total = 0;
  let count = 0;
  let zapSats = 0;
  let zapCount = 0;
  let previous = 0;

  for (const payment of payments) {
    if (!isRevenue(payment)) continue;

    const at = paymentTimeMs(payment.time);
    // A payment with no usable timestamp cannot be placed in a window, and
    // guessing puts it in this one — which is the window somebody is reading
    if (!at) continue;

    const amount = sats(payment);

    if (at < from) {
      if (at >= previousFrom) previous += amount;
      continue;
    }
    if (at > now) continue;

    total += amount;
    count += 1;

    if (isZapPayment(payment)) {
      zapSats += amount;
      zapCount += 1;
    }

    const id = revenueSourceId(payment);
    const bucket = buckets.get(id);
    if (bucket) {
      bucket.sats += amount;
      bucket.count += 1;
    } else {
      buckets.set(id, {
        id,
        label: describeRevenueSource(id),
        sats: amount,
        count: 1,
      });
    }
  }

  return {
    sats: total,
    count,
    zapSats,
    zapCount,
    otherSats: total - zapSats,
    bySource: [...buckets.values()].sort((a, b) => b.sats - a.sats),
    /*
     * No previous takings is not a 100% rise from nothing — it is nothing to
     * compare against, which is a different statement and the one worth making
     */
    change: previous > 0 ? Math.round(((total - previous) / previous) * 100) : null,
  };
}

/**
 * How the wallet's figure and the relay figure relate.
 *
 * Said out loud because the two numbers differ on purpose and the gap is the
 * interesting part: what the relays hold that never reached this wallet, and
 * what this wallet holds that Nostr was never told about.
 */
export interface Reconciliation {
  /** Settled in the wallet without a zap request attached. */
  walletOnlySats: number;
  /** Counted from receipts but not seen arriving in this wallet. */
  relayOnlySats: number;
  /** Whether the two are close enough that no explanation is needed. */
  agrees: boolean;
}

export function reconcile(
  wallet: Pick<RevenueSummary, 'sats' | 'zapSats'>,
  relaySats: number
): Reconciliation {
  const relayOnly = Math.max(0, relaySats - wallet.zapSats);
  const walletOnly = Math.max(0, wallet.sats - wallet.zapSats);

  return {
    walletOnlySats: walletOnly,
    relayOnlySats: relayOnly,
    /*
     * Within a percent of each other, or both empty. Exact equality is the
     * wrong test: rounding msat to sat and a receipt landing either side of a
     * window boundary both move the totals slightly without meaning anything.
     */
    agrees:
      relayOnly + walletOnly === 0 ||
      (relaySats > 0 &&
        Math.abs(relaySats - wallet.zapSats) / relaySats < 0.01 &&
        walletOnly === 0),
  };
}
