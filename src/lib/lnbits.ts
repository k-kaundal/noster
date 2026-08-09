import type { NostrSigner } from '@nostrify/nostrify';
import { nip98 } from 'nostr-tools';

/**
 * Client for our LNbits instance (v1.5.6).
 *
 * Only the endpoints this app actually uses are modelled. The full spec is
 * enormous — most of it is extensions we don't touch — and typing all of it
 * would be a maintenance liability with no payoff.
 */
export const LNBITS_URL =
  import.meta.env.VITE_LNBITS_URL?.replace(/\/+$/, '') ||
  'https://ln.nostrfeed.com';

/**
 * An optional shared wallet the app can issue invoices against.
 *
 * Receive-only, and deliberately so. Vite inlines every VITE_ variable into
 * the bundle, so anything configured here is readable by every visitor — an
 * invoice key only lets them pay us and see the balance, whereas an admin key
 * would let them empty the wallet. Spending always goes through the signed-in
 * user's own wallet, authorised per user by NIP-98.
 */
export const HOUSE_WALLET = {
  id: import.meta.env.VITE_LNBITS_WALLET_ID || '',
  invoiceKey: import.meta.env.VITE_LNBITS_INVOICE_KEY || '',
} as const;

export function hasHouseWallet(): boolean {
  return !!HOUSE_WALLET.invoiceKey;
}

/** Wallet as returned by `/api/v1/wallets`. */
export interface LnbitsWallet {
  id: string;
  name: string;
  /** Spends. Never persist this. */
  adminkey: string;
  /** Creates invoices and reads balance. Cannot spend. */
  inkey: string;
  /** Balance in millisatoshis. LNbits works in msat throughout. */
  balance_msat: number;
  currency?: string;
  user: string;
}

/** Where LNbits sends payment notifications for an account. */
export interface LnbitsNotifications {
  nostr_identifier?: string;
  telegram_chat_id?: string;
  email_address?: string;
  excluded_wallets?: string[];
  /** Notify above this amount, in sats. Zero means never. */
  outgoing_payments_sats?: number;
  incoming_payments_sats?: number;
}

/** The mutable half of an account, as `UserExtra` in the LNbits schema. */
export interface LnbitsUserExtra {
  email_verified?: boolean;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  picture?: string;
  provider?: string;
  notifications?: LnbitsNotifications;
}

/** Authenticated account as returned by `/api/v1/auth`. */
export interface LnbitsUser {
  id: string;
  username?: string;
  pubkey?: string;
  email?: string;
  wallets: LnbitsWallet[];
  admin: boolean;
  super_user: boolean;
  /** Whether a password has been set, so the account has a second way in. */
  has_password?: boolean;
  /** Fiat providers this account may use, e.g. `["paypal"]`. */
  fiat_providers?: string[];
  extra?: LnbitsUserExtra;
}

/** Payment as returned by `/api/v1/payments`. */
export interface LnbitsPayment {
  checking_id: string;
  payment_hash: string;
  wallet_id: string;
  /** Millisatoshis. Negative for outgoing payments. */
  amount: number;
  fee: number;
  bolt11: string;
  status: 'pending' | 'success' | 'failed' | string;
  memo?: string;
  preimage?: string;
  /** ISO 8601 on LNbits v1, a unix seconds integer on older versions. */
  time?: string | number;
  extra?: Record<string, unknown>;
}

/**
 * Epoch milliseconds for a payment, or 0 when the timestamp is unusable.
 *
 * Both timestamp shapes LNbits has shipped are accepted, because the wallet a
 * user points us at may be running either — and a payment sorted to 1970 is
 * worse than one shown without a date.
 */
export function paymentTimeMs(time: string | number | undefined): number {
  if (time === undefined || time === null || time === '') return 0;

  const numeric = typeof time === 'number' ? time : Number(time);
  if (Number.isFinite(numeric)) {
    // Seconds and milliseconds are told apart by magnitude: no plausible
    // seconds value reaches this bound, and no plausible ms value falls below
    return numeric > 1e11 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(String(time));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * An error carrying what the server actually said.
 *
 * LNbits reports failures in three different shapes depending on which layer
 * rejected the request, so a single `message` is assembled here rather than in
 * every call site.
 */
export class LnbitsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'LnbitsError';
  }
}

/**
 * Pulls a human-readable message out of an LNbits error body.
 *
 * FastAPI validation errors arrive as `{detail: [{loc, msg, type}]}`, handled
 * failures as `{detail: "..."}`, and extension endpoints as
 * `{success: false, message: "..."}`. Falling back to the status alone would
 * turn every failure into "Request failed", which tells the user nothing.
 */
export function describeError(body: unknown, status: number): string {
  if (typeof body === 'string' && body.trim()) return body;

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;

    if (typeof record.message === 'string' && record.message) {
      return record.message;
    }

    const { detail } = record;
    if (typeof detail === 'string' && detail) return detail;

    if (Array.isArray(detail)) {
      const messages = detail
        .map((entry) =>
          entry && typeof entry === 'object'
            ? String((entry as Record<string, unknown>).msg ?? '')
            : ''
        )
        .filter(Boolean);
      if (messages.length) return messages.join('; ');
    }
  }

  // The few statuses LNbits uses with a specific meaning
  if (status === 401) return 'Not authorised — sign in again.';
  if (status === 402) return 'Insufficient balance.';
  if (status === 520) return 'The Lightning node rejected the payment.';

  return `Request failed (${status})`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Wallet key for `X-API-KEY` endpoints. */
  apiKey?: string;
  /** Session token for bearer endpoints. */
  token?: string;
  signal?: AbortSignal;
}

/**
 * One request to LNbits.
 *
 * Credentials are included so the session cookie LNbits sets on login is sent
 * back; the bearer token is passed too, because whether the cookie is usable
 * depends on how the instance is hosted relative to this app.
 */
export async function lnbitsRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, apiKey, token, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (apiKey) headers['X-API-KEY'] = apiKey;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${LNBITS_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    throw new LnbitsError(
      describeError(parsed, response.status),
      response.status,
      parsed
    );
  }

  return parsed as T;
}

/**
 * Builds the NIP-98 `Authorization` header for a request.
 *
 * The URL must be absolute and match exactly what the server sees, since
 * LNbits validates it against its `nostr_absolute_request_urls` setting.
 */
export async function nip98Header(
  signer: NostrSigner,
  url: string,
  method: string,
  payload?: Record<string, unknown>
): Promise<string> {
  return nip98.getToken(
    url,
    method,
    (event) => signer.signEvent({ ...event, kind: 27235 }) as never,
    true,
    payload
  );
}

/**
 * Whether a failure is LNbits rejecting the `u` tag specifically.
 *
 * Told apart from every other login failure because it is the only one a
 * differently-spelled URL could fix; a bad signature or a deactivated account
 * would fail identically on a second attempt.
 */
function isUrlTagRejection(error: unknown): boolean {
  return (
    error instanceof LnbitsError && /tag 'u'/i.test(error.message)
  );
}

/**
 * Logs in with a Nostr key. Returns the session token, when one is issued.
 *
 * LNbits does not check the NIP-98 `u` tag against the URL actually requested.
 * It accepts `<entry>/nostr` for each entry of its `nostr_absolute_request_urls`
 * setting, which defaults to a bare origin — so the value it wants is usually
 * `https://host/nostr`, not the endpoint's own path. Since an operator may have
 * configured either spelling, both are tried instead of requiring every
 * deployment to be set up the way ours is.
 */
export async function loginWithNostr(
  signer: NostrSigner
): Promise<string | undefined> {
  const endpoint = `${LNBITS_URL}/api/v1/auth/nostr`;
  const candidates = [`${LNBITS_URL}/nostr`, endpoint];

  let lastError: unknown;

  for (const signedUrl of candidates) {
    try {
      return await postNostrLogin(signer, endpoint, signedUrl);
    } catch (error) {
      if (!isUrlTagRejection(error)) throw error;
      lastError = error;
    }
  }

  throw lastError;
}

/** One nostr login attempt, signing `signedUrl` while posting to `endpoint`. */
async function postNostrLogin(
  signer: NostrSigner,
  endpoint: string,
  signedUrl: string
): Promise<string | undefined> {
  const authorization = await nip98Header(signer, signedUrl, 'POST');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: authorization },
    credentials: 'include',
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new LnbitsError(
      describeError(parsed, response.status),
      response.status,
      parsed
    );
  }

  // LNbits sets an access-token cookie and may also return it in the body.
  // The cookie alone works same-origin; the token is kept for the cross-origin
  // case, where the browser will not send a third-party cookie.
  return readAccessToken(parsed);
}

/**
 * Logs in with a username and password.
 *
 * The second way into the same account. Someone who set a password — or who
 * already had an LNbits account before finding this app — can reach their
 * wallet on a device where their Nostr signer isn't installed.
 */
export async function loginWithPassword(
  username: string,
  password: string
): Promise<string | undefined> {
  const body = await lnbitsRequest<unknown>('/api/v1/auth', {
    method: 'POST',
    body: { username, password },
  });

  return readAccessToken(body);
}

/**
 * Whether a failure means "nobody is signed in" rather than something broken.
 *
 * LNbits answers an unauthenticated `/api/v1/auth` with a 400 and
 * "Missing user ID or access token", not the 401 the status would suggest.
 * Treating that as an error surfaces raw API text to someone whose only crime
 * was opening the app in a browser they hadn't used before.
 */
export function isMissingSession(error: unknown): boolean {
  if (!(error instanceof LnbitsError)) return false;

  if (error.status === 401 || error.status === 403) return true;

  return (
    error.status === 400 &&
    /missing user id|access token|not authenticated/i.test(error.message)
  );
}

/** Reads an access token out of a login response, whatever shape it takes. */
export function readAccessToken(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const record = body as Record<string, unknown>;
  for (const key of ['access_token', 'token', 'accessToken']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/**
 * Reads a wallet balance in millisats out of whatever shape came back.
 *
 * LNbits' own API panel documents `GET /api/v1/wallet` as returning
 * `{id, name, balance}` while the v1.5.6 OpenAPI models it as `balance_msat`.
 * Both are millisats; only the field name differs by endpoint and version, so
 * reading just one would silently show a zero balance on the other.
 */
export function readBalanceMsat(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;

  const record = body as Record<string, unknown>;
  for (const key of ['balance_msat', 'balance']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * The bolt11 string, whichever field carries it.
 *
 * `POST /api/v1/payments` is documented as returning `payment_request`, while
 * the OpenAPI `Payment` model names it `bolt11` and marks `payment_request` as
 * a non-persisted alias. Which one is populated depends on the endpoint.
 */
export function readBolt11(body: unknown): string {
  if (!body || typeof body !== 'object') return '';

  const record = body as Record<string, unknown>;
  for (const key of ['bolt11', 'payment_request']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/** Millisatoshis to whole satoshis, rounded down as balances always are. */
export function msatToSat(msat: number): number {
  return Math.floor(msat / 1000);
}

export function satToMsat(sat: number): number {
  return Math.round(sat * 1000);
}
