/**
 * The paid relay, and who it will accept writes from.
 *
 * A second relay beside the free one, on its own host, running nostream with
 * LNbits as its payment processor. Admission is bought once per pubkey rather
 * than rented: there is no expiry to track and no renewal to miss, which makes
 * it a toll against spam rather than a subscription.
 *
 * Two things about this file decide most of its shape.
 *
 * **The relay is the only authority.** Nothing stored in this browser can
 * grant access — the relay accepts or rejects the write, and the page's job is
 * to report that rather than to claim it. The page used to say "Paid from this
 * account" from a `localStorage` record, which is a sentence anybody with
 * devtools can produce and which stayed true after a payment was refunded,
 * failed, or made from a different key.
 *
 * **A failed check is not a refusal.** `paid.nostrfeed.com` is a different
 * origin from the app, so every request here depends on CORS headers that
 * nginx has to be configured to send. If they are missing — or the host is
 * down, or the network is hostile — the check fails, and the one thing that
 * must never happen is telling somebody who has paid that they have not, then
 * inviting them to pay again. So admission is three-valued, exactly as
 * `nip11.Support` is, and "we could not ask" gets its own answer.
 */
import type { RelayInfo } from '@/lib/nip11';

/** The relay that charges for writes. Reading it is open to everybody. */
export const PAID_RELAY_URL =
  import.meta.env.VITE_PAID_RELAY?.trim() || 'wss://paid.nostrfeed.com';

/** Where admission is bought and checked. nostream serves both over HTTP. */
export const ADMISSION_URL = (
  import.meta.env.VITE_PAID_RELAY_ADMISSION?.trim() ||
  'https://paid.nostrfeed.com'
).replace(/\/+$/, '');

/**
 * What admission costs when the relay has not said.
 *
 * A fallback for the first paint and for a relay whose NIP-11 document cannot
 * be fetched — never preferred over `admissionFeeSats`, because the price is
 * the operator's to change and this constant is a copy that goes stale the
 * moment they do.
 */
export const ADMISSION_SATS = 2100;

/**
 * Three-valued, because "the relay did not answer" is not "the relay said no".
 *
 * - `admitted` — the relay confirmed this key may write.
 * - `unpaid` — the relay confirmed it may not.
 * - `unknown` — nobody answered. Never treated as `unpaid`.
 */
export type AdmissionState = 'admitted' | 'unpaid' | 'unknown';

/** Where to ask about one key. */
export function admissionCheckUrl(pubkey: string, base = ADMISSION_URL): string {
  return `${base.replace(/\/+$/, '')}/admissions/check/${pubkey}`;
}

/**
 * Where invoices are made, and read.
 *
 * `POST` mints one; `GET` with a JSON Accept header quotes the fee without
 * minting anything. Also the web pay page, which this app uses only as a
 * fallback — paying belongs in the client, and sending somebody out to a
 * browser tab to buy something loses most of them at the door.
 */
export function admissionInvoicesUrl(base = ADMISSION_URL): string {
  return `${base.replace(/\/+$/, '')}/invoices`;
}

/**
 * The web pay page, for when the in-app path cannot run at all.
 *
 * The key is prefilled because the page otherwise asks somebody to paste
 * their own npub — an extra step, and a chance to paste the wrong one and buy
 * admission for a key they do not hold.
 */
export function admissionPayUrl(
  pubkey?: string,
  base = ADMISSION_URL
): string {
  const url = admissionInvoicesUrl(base);
  return pubkey ? `${url}?pubkey=${encodeURIComponent(pubkey)}` : url;
}

/** An invoice for admission, as the relay describes one. */
export interface AdmissionInvoice {
  /** Absent when the key was already admitted and there is nothing to pay. */
  bolt11?: string;
  /** The payment hash, which is also the id the status route takes. */
  id?: string;
  amountSats: number;
  /** Where to poll. Given by the relay rather than built, so a moved route
   *  follows on its own. */
  statusUrl?: string;
  /** Seconds since epoch, or null when the relay did not say. */
  expiresAt: number | null;
  status: InvoiceStatus;
  /**
   * Whether this key is already in.
   *
   * The relay answers a `POST` for an admitted key with this set and no
   * invoice, which is the case that must never turn into a second charge.
   */
  userAdmitted: boolean;
}

export type InvoiceStatus = 'pending' | 'completed' | 'expired' | 'unknown';

function readStatus(value: unknown): InvoiceStatus {
  return value === 'pending' || value === 'completed' || value === 'expired'
    ? value
    : 'unknown';
}

/**
 * Reads the relay's invoice, in whichever shape it sent one.
 *
 * The documented response quotes `amount_sats`, and nostream's own API has
 * historically quoted millisats under `amount`. Reading the wrong one is a
 * factor of a thousand on a number shown next to a QR code, so each is read
 * from its own field and neither is converted into the other.
 */
export function readInvoice(body: unknown): AdmissionInvoice | null {
  if (!body || typeof body !== 'object') return null;

  const row = body as Record<string, unknown>;
  const nested = (row.invoice ?? {}) as Record<string, unknown>;

  const pick = <T>(...values: unknown[]): T | undefined =>
    values.find((value) => value !== undefined && value !== null && value !== '') as
      | T
      | undefined;

  const userAdmitted = row.userAdmitted === true;

  const bolt11 = pick<string>(
    row.bolt11,
    row.paymentRequest,
    row.payment_request,
    nested.bolt11,
    nested.paymentRequest,
    nested.payment_request
  );

  // An admitted key comes back with no invoice, which is an answer rather
  // than a failure — everything else with no invoice is a failure
  if (!bolt11 && !userAdmitted) return null;

  const sats = Number(pick(row.amount_sats, nested.amount_sats));
  const msats = Number(pick(row.amount, nested.amount));

  const expires = pick<string | number>(row.expires_at, nested.expires_at);
  const expiresAt =
    typeof expires === 'number'
      ? expires
      : typeof expires === 'string'
        ? Math.floor(Date.parse(expires) / 1000) || null
        : null;

  return {
    bolt11,
    id: pick<string>(row.id, nested.id),
    amountSats: Number.isFinite(sats) && sats > 0
      ? Math.round(sats)
      : Number.isFinite(msats) && msats > 0
        ? Math.ceil(msats / 1000)
        : 0,
    statusUrl: pick<string>(row.status_url, nested.status_url),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    status: readStatus(row.status ?? nested.status),
    userAdmitted,
  };
}

/** Reads a poll of the status route. */
export function readInvoiceStatus(body: unknown): InvoiceStatus {
  if (!body || typeof body !== 'object') return 'unknown';
  return readStatus((body as Record<string, unknown>).status);
}

/**
 * Reads the relay's answer, or admits to not having one.
 *
 * `null` rather than `false` for anything unrecognised. A body that is not the
 * shape we expect — an nginx error page, an HTML login screen, a JSON document
 * from a future version — says nothing about whether this key has paid, and
 * reading it as "no" would charge somebody twice.
 */
export function readAdmission(body: unknown): boolean | null {
  if (!body || typeof body !== 'object') return null;

  const value = (body as Record<string, unknown>).userAdmitted;
  return typeof value === 'boolean' ? value : null;
}

/**
 * What the relay charges for admission, from its own NIP-11 document.
 *
 * Preferred over the constant above because the operator changes this in
 * `settings.yaml` and restarts nostream — at which point a hardcoded price in
 * a static site is simply wrong, and wrong in the direction that produces an
 * underpaid invoice and no admission.
 *
 * The unit matters and is easy to get wrong: nostream configures fees in
 * millisats, so a document may quote either `2100 sats` or `2100000 msats` for
 * the same price. Reading the number without the unit is a factor of a
 * thousand in whichever direction hurts.
 */
export function admissionFeeSats(info: RelayInfo | null | undefined): number | null {
  const fee = info?.fees?.admission?.[0];
  if (!fee || typeof fee.amount !== 'number' || fee.amount <= 0) return null;

  const unit = String(fee.unit ?? '').toLowerCase();

  if (unit === 'msats' || unit === 'msat' || unit === 'millisats') {
    return Math.ceil(fee.amount / 1000);
  }

  // "sats", "sat", "btc"-less and anything unlabelled: NIP-11's own examples
  // quote sats, so an absent unit is read as sats rather than refused
  return Math.round(fee.amount);
}

/**
 * Whether the relay is advertising paid writes at all.
 *
 * Separate from the fee, because a relay can require payment without quoting
 * one, and because this is what distinguishes "the paid relay is live" from
 * "the paid relay is serving nginx's default page" — the state this deployment
 * is actually in until certbot has run.
 */
export function requiresPayment(info: RelayInfo | null | undefined): boolean {
  return info?.limitation?.payment_required === true;
}

/** What to tell somebody about where they stand. */
export function describeAdmission(state: AdmissionState): string {
  switch (state) {
    case 'admitted':
      return 'The relay accepts writes from this account.';
    case 'unpaid':
      return 'The relay does not accept writes from this account yet.';
    default:
      /*
       * Said plainly rather than dressed up as a refusal. Somebody in this
       * state may well have paid, and the honest answer is that this browser
       * could not reach the relay to find out.
       */
      return "Couldn't reach the relay to check this account.";
  }
}

/**
 * The rejection a relay sends when the writer has not been admitted.
 *
 * NIP-20 machine-readable prefix. Recognised so a failed publish can say what
 * is actually wrong instead of retrying forever in the outbox, which is what
 * an unadmitted account currently gets.
 */
export function isAdmissionRejection(message: string | undefined): boolean {
  if (!message) return false;

  const text = message.toLowerCase();
  return (
    text.startsWith('blocked:') &&
    (text.includes('not admitted') || text.includes('admission'))
  );
}

/**
 * Whether a relay is the paid one.
 *
 * Asked wherever traffic must not go there. DMs, NWC and bunker all belong on
 * the free relay: the paid relay refuses writes from unadmitted keys, and the
 * person on the other end has no reason to be reading it — so a gift wrap sent
 * there is both rejected and unread, which are two different failures at once.
 *
 * Compared on the host rather than the whole URL, since a relay list written
 * by another client may carry a trailing slash or a `wss://` the config spells
 * differently.
 */
export function isPaidRelay(url: string, paid = PAID_RELAY_URL): boolean {
  const host = (value: string) => {
    try {
      return new URL(value).host.toLowerCase();
    } catch {
      return value.trim().toLowerCase().replace(/^wss?:\/\//, '').replace(/\/+$/, '');
    }
  };

  return !!url && host(url) === host(paid);
}
