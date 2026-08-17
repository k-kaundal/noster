/**
 * The wallet's payments, as something a person can read.
 *
 * LNbits answers with rows from its ledger: a signed millisatoshi amount, a
 * status string, and a timestamp. That is enough to render "+5,000" and not
 * much else, which is how the activity list ended up showing an invoice nobody
 * had paid in the same shape as money that had actually arrived — dimmed
 * slightly, with the word "pending" hidden behind a tap.
 *
 * The distinction those rows are missing is between a *payment* and a *payment
 * request*. An unpaid incoming invoice is not a receipt; it is an open offer
 * that either gets paid, or expires and never will. It needs different words,
 * different actions — copy it, show the QR again, watch it settle — and it
 * needs to stop being counted as money.
 */
import {
  msatToSat,
  paymentTimeMs,
  type LnbitsPayment,
} from '@/lib/lnbits';

/**
 * How long an invoice lives when the server did not say.
 *
 * BOLT-11's own default, and LNbits' default too. Used only as a fallback:
 * without one, an invoice that died months ago sits in the list as an open
 * request forever, which is worse than assuming the standard hour.
 */
export const DEFAULT_INVOICE_TTL_MS = 3600 * 1000;

export type PaymentState =
  /** Money that arrived. */
  | 'received'
  /** Money that left. */
  | 'sent'
  /** An invoice we issued that nobody has paid yet, and still could. */
  | 'request'
  /** One that ran out of time. Nobody can pay it now. */
  | 'expired'
  /** A payment we started that has not confirmed. */
  | 'sending'
  /** One the network gave back. */
  | 'failed';

export interface WalletPayment {
  id: string;
  hash: string;
  direction: 'incoming' | 'outgoing';
  state: PaymentState;
  /** Satoshis, always positive. The direction carries the sign. */
  sats: number;
  /** Routing fee in sats, outgoing only. */
  feeSats: number;
  memo: string;
  bolt11: string;
  preimage?: string;
  createdAt: number;
  /** When an unpaid invoice stops being payable. */
  expiresAt: number | null;
  /** Which LNbits extension made it, when one did — `lnurlp`, `nostrnip5`. */
  tag?: string;
}

function readTag(extra: Record<string, unknown> | undefined): string | undefined {
  const tag = extra?.tag ?? extra?.extension;
  return typeof tag === 'string' && tag ? tag : undefined;
}

/**
 * Reads one row into the shape above.
 *
 * Tolerant on purpose. This app talks to whichever LNbits the operator points
 * it at, and the fields here have changed shape across versions — timestamps
 * as ISO strings or unix seconds, `expiry` present or absent, `status` versus
 * the older `pending` boolean. A row that fails to parse cleanly should render
 * as an ordinary payment, not vanish or throw.
 */
export function readPayment(
  raw: LnbitsPayment & { expiry?: string | number; pending?: boolean },
  now = Date.now()
): WalletPayment {
  const msat = Number(raw.amount) || 0;
  const direction = msat < 0 ? 'outgoing' : 'incoming';

  const createdAt = paymentTimeMs(raw.time);
  const expiry = paymentTimeMs(raw.expiry);

  /*
   * Only incoming invoices carry an expiry that matters: an outgoing payment
   * is either made or not, and its invoice's expiry is somebody else's clock.
   */
  const expiresAt =
    direction === 'incoming'
      ? expiry || (createdAt ? createdAt + DEFAULT_INVOICE_TTL_MS : null)
      : null;

  const status = readStatus(raw);

  return {
    id: raw.payment_hash || raw.checking_id || '',
    hash: raw.payment_hash || '',
    direction,
    state: readState({ direction, status, expiresAt }, now),
    /*
     * Absolute first, then converted. `msatToSat` floors, and flooring a
     * negative rounds away from zero — so an outgoing 50,500 msat read as 51
     * sats and a 1,500 msat fee read as 2. Every outgoing figure in the app
     * was rounded up, which is the wrong direction to be wrong about somebody
     * else's money.
     */
    sats: msatToSat(Math.abs(msat)),
    feeSats: msatToSat(Math.abs(Number(raw.fee) || 0)),
    memo: (raw.memo || '').trim(),
    bolt11: raw.bolt11 || '',
    preimage: raw.preimage || undefined,
    createdAt,
    expiresAt,
    tag: readTag(raw.extra),
  };
}

function readStatus(
  raw: Pick<LnbitsPayment, 'status'> & { pending?: boolean }
): 'pending' | 'success' | 'failed' {
  if (raw.status === 'success' || raw.status === 'failed') return raw.status;
  if (raw.status === 'pending') return 'pending';

  // Older LNbits reported settlement as a boolean instead of a status
  if (typeof raw.pending === 'boolean') return raw.pending ? 'pending' : 'success';

  /*
   * An unrecognised status reads as settled rather than pending. These rows
   * come back from a `/payments` list the wallet's balance already reflects,
   * so calling one "awaiting payment" would invent an open request that
   * nobody can act on and that will never resolve.
   */
  return 'success';
}

function readState(
  input: {
    direction: 'incoming' | 'outgoing';
    status: 'pending' | 'success' | 'failed';
    expiresAt: number | null;
  },
  now: number
): PaymentState {
  if (input.status === 'failed') return 'failed';

  if (input.status === 'pending') {
    if (input.direction === 'outgoing') return 'sending';
    return input.expiresAt !== null && input.expiresAt <= now
      ? 'expired'
      : 'request';
  }

  return input.direction === 'incoming' ? 'received' : 'sent';
}

/** Whether a row is money that moved, rather than an offer that might not. */
export function isSettled(payment: WalletPayment): boolean {
  return payment.state === 'received' || payment.state === 'sent';
}

/** An invoice still waiting, and still payable. */
export function isOpenRequest(payment: WalletPayment): boolean {
  return payment.state === 'request';
}

/** Whole minutes until an unpaid invoice dies, or null when that is not a fact. */
export function minutesLeft(
  payment: WalletPayment,
  now = Date.now()
): number | null {
  if (payment.state !== 'request' || payment.expiresAt === null) return null;
  return Math.max(0, Math.ceil((payment.expiresAt - now) / 60_000));
}

export interface PaymentTotals {
  inSats: number;
  outSats: number;
  /** Settled rows only — an unpaid request is not part of what moved. */
  count: number;
}

/**
 * What actually moved over a window.
 *
 * Requests are excluded rather than counted at zero: they are not money and
 * including them in the count would make "12 payments" mean something the
 * balance disagrees with.
 */
export function totals(
  payments: WalletPayment[],
  since?: number
): PaymentTotals {
  return payments.reduce<PaymentTotals>(
    (sum, payment) => {
      if (!isSettled(payment)) return sum;
      if (since !== undefined && payment.createdAt < since) return sum;

      if (payment.direction === 'incoming') sum.inSats += payment.sats;
      else sum.outSats += payment.sats + payment.feeSats;

      sum.count += 1;
      return sum;
    },
    { inSats: 0, outSats: 0, count: 0 }
  );
}

export type ActivityFilter = 'all' | 'in' | 'out' | 'requests';

export function filterPayments(
  payments: WalletPayment[],
  filter: ActivityFilter,
  query = ''
): WalletPayment[] {
  const needle = query.trim().toLowerCase();

  return payments.filter((payment) => {
    switch (filter) {
      case 'in':
        if (payment.state !== 'received') return false;
        break;
      case 'out':
        if (payment.state !== 'sent' && payment.state !== 'sending') return false;
        break;
      case 'requests':
        // Expired ones belong here too: this is the tab somebody opens to find
        // out what happened to an invoice they sent to somebody
        if (payment.state !== 'request' && payment.state !== 'expired') {
          return false;
        }
        break;
      default:
        break;
    }

    if (!needle) return true;

    /*
     * An all-digits query is an amount, and it has to match exactly. Substring
     * matching on the number looks helpful and is not: searching 500 would
     * return every 5,000 and 1,500 in the list, which is the opposite of what
     * somebody hunting for one payment wants.
     */
    const amount = /^[\d,\s]+$/.test(needle)
      ? Number(needle.replace(/[,\s]/g, ''))
      : null;

    if (amount !== null && Number.isFinite(amount) && payment.sats === amount) {
      return true;
    }

    return (
      payment.memo.toLowerCase().includes(needle) ||
      payment.hash.toLowerCase().includes(needle)
    );
  });
}

export interface PaymentDay {
  key: string;
  label: string;
  payments: WalletPayment[];
}

/**
 * Grouped by the day they happened, newest first.
 *
 * A flat list of fifty rows is a wall of numbers; the date is the thing people
 * navigate by when they are looking for one payment in particular.
 */
export function groupByDay(
  payments: WalletPayment[],
  now = Date.now()
): PaymentDay[] {
  const days = new Map<string, WalletPayment[]>();

  for (const payment of [...payments].sort(
    (a, b) => b.createdAt - a.createdAt
  )) {
    const key = dayKey(payment.createdAt);
    const bucket = days.get(key);
    if (bucket) bucket.push(payment);
    else days.set(key, [payment]);
  }

  return [...days.entries()].map(([key, list]) => ({
    key,
    label: dayLabel(key, now),
    payments: list,
  }));
}

function dayKey(timestamp: number): string {
  // Zero is what an unreadable timestamp parses to, and filing it under 1970
  // would bury a real payment at the bottom of the list under a wrong date
  if (!timestamp) return 'unknown';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'unknown';

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function dayLabel(key: string, now: number): string {
  if (key === 'unknown') return 'Undated';

  const today = dayKey(now);
  if (key === today) return 'Today';
  if (key === dayKey(now - 86_400_000)) return 'Yesterday';

  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;

  try {
    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year:
        date.getFullYear() === new Date(now).getFullYear()
          ? undefined
          : 'numeric',
    });
  } catch {
    return key;
  }
}

/** A short, relative time for a row. */
export function timeAgo(timestamp: number, now = Date.now()): string {
  if (!timestamp) return '';

  const seconds = Math.max(0, (now - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;

  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export interface PaymentCopy {
  title: string;
  detail?: string;
}

/**
 * What a row says.
 *
 * The memo wins when there is one — it is what the person wrote at the time,
 * and it beats anything derivable. What replaces it says what happened rather
 * than which direction the number went, because "Sent" and "−1,000" are the
 * same fact twice.
 */
export function describePayment(payment: WalletPayment): PaymentCopy {
  const source = payment.tag ? sourceLabel(payment.tag) : undefined;

  switch (payment.state) {
    case 'request':
      return {
        title: payment.memo || 'Payment request',
        detail: 'Waiting to be paid',
      };
    case 'expired':
      return {
        title: payment.memo || 'Payment request',
        detail: 'Expired unpaid',
      };
    case 'sending':
      return { title: payment.memo || 'Sending', detail: 'Not confirmed yet' };
    case 'failed':
      return { title: payment.memo || 'Payment failed', detail: 'Not sent' };
    case 'received':
      return { title: payment.memo || 'Received', detail: source };
    default:
      return { title: payment.memo || 'Sent', detail: source };
  }
}

function sourceLabel(tag: string): string | undefined {
  switch (tag) {
    case 'lnurlp':
      return 'To your lightning address';
    case 'nostrnip5':
      return 'For a verified name';
    case 'lnurlw':
      return 'Withdraw link';
    default:
      return undefined;
  }
}
