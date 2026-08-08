import type { NostrSigner } from '@nostrify/nostrify';
import { nip98 } from 'nostr-tools';

/**
 * Client for our LNbits instance (v1.5.6).
 *
 * Only the endpoints this app actually uses are modelled. The full spec is
 * enormous — most of it is extensions we don't touch — and typing all of it
 * would be a maintenance liability with no payoff.
 */
export const LNBITS_URL = 'https://ln.nostrfeed.com';

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

/** Authenticated account as returned by `/api/v1/auth`. */
export interface LnbitsUser {
  id: string;
  username?: string;
  pubkey?: string;
  email?: string;
  wallets: LnbitsWallet[];
  admin: boolean;
  super_user: boolean;
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
  time?: string;
  extra?: Record<string, unknown>;
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

/** Logs in with a Nostr key. Returns the session token, when one is issued. */
export async function loginWithNostr(
  signer: NostrSigner
): Promise<string | undefined> {
  const url = `${LNBITS_URL}/api/v1/auth/nostr`;
  const authorization = await nip98Header(signer, url, 'POST');

  const response = await fetch(url, {
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

/** Millisatoshis to whole satoshis, rounded down as balances always are. */
export function msatToSat(msat: number): number {
  return Math.floor(msat / 1000);
}

export function satToMsat(sat: number): number {
  return Math.round(sat * 1000);
}
