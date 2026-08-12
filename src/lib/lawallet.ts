import type { NostrSigner } from '@nostrify/nostrify';
import { nip98Header } from './lnbits';

/**
 * Client for the LaWallet NWC service behind `wallet.nostrfeed.com`.
 *
 * The interesting thing it offers is not another custodial balance — this app
 * already has one — but an address whose *destination is a choice*. A
 * `kind`-less LNbits pay link always pays the LNbits wallet behind it. A
 * LaWallet address has a `mode`, and can forward to an address held anywhere
 * else, or be backed by a wallet the person connects themselves over NWC.
 *
 * That makes it the answer to the thing neither of the other two paths solve:
 * keeping one name while changing what is behind it.
 */

/** Where the API lives. Administration, not identity. */
export const LAWALLET_URL =
  import.meta.env.VITE_LAWALLET_URL?.replace(/\/+$/, '') ||
  'https://wallet.nostrfeed.com';

/**
 * The domain addresses read as — `kk@getzap.me`, not `kk@wallet.nostrfeed.com`.
 *
 * Deliberately not derived from `LAWALLET_URL`, which it used to be. The host
 * the service is administered on and the domain it issues names under are two
 * separate decisions, and here they differ: the platform is at
 * `wallet.nostrfeed.com` and hands out `@getzap.me`. Deriving one from the
 * other printed the wrong address on screen and in the profile, which is the
 * one thing an address must not get wrong.
 *
 * A fallback rather than the truth, though. The service reports the domain on
 * every directory record, so `resolveIssuedDomain` prefers what it says and
 * this is what stands in until the answer arrives.
 */
export const LAWALLET_DOMAIN =
  import.meta.env.VITE_LAWALLET_ADDRESS_DOMAIN?.replace(/^@/, '') || 'getzap.me';

/**
 * What an address does when someone pays it.
 *
 * - `IDLE` — nothing. It resolves and refuses, which is a name held but not
 *   yet pointed anywhere.
 * - `ALIAS` — forwards to another lightning address, given in `redirect`.
 * - `PROXY_ALIAS` — forwards too, but through the service's settlement queue,
 *   which can issue NIP-57 receipts on behalf of a destination that cannot.
 * - `CUSTOM_NWC` — paid by a wallet the person connected over NWC.
 */
export type AddressMode = 'IDLE' | 'ALIAS' | 'PROXY_ALIAS' | 'CUSTOM_NWC';

export interface WalletAddress {
  username: string;
  mode: AddressMode;
  redirect?: string | null;
  remoteWalletId?: string | null;
  isPrimary?: boolean;
}

/**
 * Whether an address can actually be paid, and by what.
 *
 * `source: "unavailable"` with a `reason` is the case worth surfacing: the
 * address resolves, so it looks fine, and then refuses every payment sent to
 * it. Someone who published it has no way to tell from the outside.
 */
export interface AddressProtocols {
  protocols?: {
    lud16?: boolean;
    nip05?: boolean;
    lud21?: boolean;
    nip57?: boolean;
    lud12?: boolean;
  };
  source?: string;
  reason?: string | null;
  provider?: string | null;
}

/**
 * A row in the service's address directory.
 *
 * Documented as a thin record — username, pubkey, domain — and in practice a
 * full one: mode, destination, primary flag and protocol support all come
 * back. Both are modelled, because the fields the schema promises are the ones
 * that can be missing and the extras are the ones worth using.
 */
export interface DirectoryAddress extends Partial<WalletAddress> {
  username: string;
  pubkey?: string | null;
  domain?: string;
  protocols?: AddressProtocols;
}

/**
 * Reads a list response whichever shape it arrives in.
 *
 * The schema says these endpoints answer `{ data: [...] }`. The service
 * answers with a bare array. Reading only the documented shape meant every
 * lookup found nothing and reported it as "you have no addresses" — which is
 * indistinguishable from the truth and so went unnoticed.
 */
export function unwrapList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];

  if (body && typeof body === 'object' && 'data' in body) {
    const data = (body as { data?: unknown }).data;
    if (Array.isArray(data)) return data as T[];
  }

  return [];
}

/** Whether the service says this address currently accepts payments. */
export function acceptsPayments(address: DirectoryAddress): boolean {
  const info = address.protocols;
  if (!info) return true;

  if (info.source === 'unavailable') return false;
  return info.protocols?.lud16 !== false;
}

/** Why it does not, in the service's own words. */
export function refusalReason(address: DirectoryAddress): string | null {
  if (acceptsPayments(address)) return null;
  return address.protocols?.reason?.trim() || 'This address rejects payments.';
}

/**
 * An address this person holds, however it got here.
 *
 * `settings` is present for the ones the service returns as the caller's own,
 * and absent for one found only by its link to their key — which happens when
 * the address was made under a different account on the same platform. The
 * difference is worth keeping rather than flattening: an address with no
 * settings can be shown and published, but not pointed anywhere, and claiming
 * otherwise would put an editor on screen whose every save fails.
 */
export interface HeldAddress {
  username: string;
  domain: string;
  address: string;
  settings: WalletAddress | null;
  /** The one the service treats as this person's main address. */
  isPrimary: boolean;
  /** Null when it takes payments; the service's own words when it does not. */
  refusal: string | null;
}

export interface RemoteWallet {
  id: string;
  name: string;
  type: 'NWC' | 'LND' | 'CLN' | 'BTCPAY';
  status: 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'DEAD';
  isDefault: boolean;
}

/** What the service says about an address before it is used as an alias. */
export interface AliasProbe {
  address: string;
  /** Whether the alias may be saved at all — LUD-16 has to work. */
  canSave: boolean;
  checks: {
    lud16: { ok: boolean; message: string };
    lud21: { ok: boolean; message: string };
    nip57: { ok: boolean; message: string };
  };
}

/**
 * The service's own record of a key, from `GET /api/users/me`.
 *
 * That route is documented as "load or create", and it is the only one that
 * creates. A Nostr signature proves who somebody is, but it does not give the
 * service a row to hang an address off — so every write here needs this to
 * have been called at least once for the key doing the writing.
 */
export interface LaWalletUser {
  id: string;
  pubkey: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'USER';
  createdAt: string;
}

export class LaWalletError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'LaWalletError';
  }
}

/**
 * Whether a refusal means "this key has no account here" specifically.
 *
 * The same condition surfaces under two codes depending on which layer
 * catches it. `AUTHENTICATION_ERROR` is the auth chain: the schema says every
 * authenticated request runs through `resolveRole(pubkey)`, whose first step
 * is to look up the `User` row, so a key with no row is turned away as though
 * it had not signed at all. `NOT_FOUND` is a handler that got past the chain
 * and then could not find the record itself.
 *
 * The message is consulted as well as the code, which is not something to do
 * lightly. But `NOT_FOUND` is also what a write against a deleted *address*
 * answers with, and the two want opposite handling: one is fixed by
 * registering and retrying, the other is fixed by nothing and would spend a
 * signature discovering that.
 */
export function isMissingUser(error: unknown): boolean {
  return (
    error instanceof LaWalletError &&
    (error.code === 'NOT_FOUND' || error.code === 'AUTHENTICATION_ERROR') &&
    /user not found/i.test(error.message)
  );
}

/** A session token from `POST /api/jwt`, with what the service said about it. */
export interface LaWalletSession {
  token: string;
  /** ISO 8601. Absent on an instance that does not report one. */
  expiresAt?: string;
  pubkey?: string;
  role?: 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'USER';
}

/**
 * Trades a NIP-98 signature for a session token — and, in doing so, gets a
 * key through the door for the first time.
 *
 * This is the registration step, though nothing calls it that. `POST /api/jwt`
 * is the only route in the schema that is both `PUBLIC` and NIP-98 signed,
 * which makes it the only one whose auth chain does not first demand a `User`
 * row. Every other route — `GET /api/users/me` included, despite being the one
 * documented to "load or create" a user — is role `USER` and so refuses a key
 * that has never been seen with "User not found".
 *
 * So a new key cannot reach the route that would create it by signing each
 * request. It has to come through here first.
 */
export async function openSession(
  signer: NostrSigner,
  expiresIn = '1h'
): Promise<LaWalletSession> {
  /**
   * The body is sent explicitly rather than omitted. NIP-98 hashes the payload
   * into the signed event, so what is sent and what is signed have to be the
   * same bytes — and "no body" and "an empty body" are not the same bytes.
   */
  const body = await laWalletRequest<Record<string, unknown>>('/api/jwt', {
    method: 'POST',
    body: { expiresIn },
    signer,
  });

  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) {
    throw new LaWalletError('The wallet service issued no session token.', 200);
  }

  return {
    token,
    expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
    pubkey: typeof body.pubkey === 'string' ? body.pubkey : undefined,
    role: body.role as LaWalletSession['role'],
  };
}

/**
 * How long a session is worth caching, in milliseconds.
 *
 * Cut short of the real expiry, because a token that expires mid-request is
 * indistinguishable from a token that was never valid — and the recovery from
 * that is a signer prompt somebody did not ask for. An instance that reports
 * no expiry gets the schema's own default of an hour, shortened the same way.
 */
export function sessionLifetimeMs(
  session: LaWalletSession,
  now = Date.now()
): number {
  const margin = 60_000;
  const parsed = session.expiresAt ? Date.parse(session.expiresAt) : NaN;

  if (Number.isNaN(parsed)) return 60 * 60_000 - margin;

  return Math.max(0, parsed - now - margin);
}

/**
 * Whether a refusal is one to expect rather than one to report.
 *
 * Two of them, and both are the normal state for an ordinary account:
 *
 * - **404 / NOT_FOUND** — no account on the service yet, which is true of
 *   everybody until they first use it.
 * - **403 / AUTHORIZATION_ERROR** — the route needs a role this person does
 *   not have. `GET /api/lightning-addresses` is marked `VIEWER` in the
 *   schema, so the global directory refuses every ordinary user by design.
 *
 * Both were being treated as failures, and a failed query has no data to go
 * stale, so React Query refetched all three on every mount of anything that
 * reads identity — which, since identity feeds the profile and the composer,
 * is most of the app. Answering empty is what turns a permanent stream of
 * refused requests into one request per cache window.
 *
 * 401 is deliberately not in this list, with one exception. A 401 normally
 * means the signature itself did not verify, which is worth telling somebody
 * about rather than hiding behind an empty list — but the auth chain also
 * answers 401 for a key that signed perfectly and simply has no account yet,
 * and that is the same ordinary state as the 404 above.
 */
export function isExpectedDenial(error: unknown): boolean {
  if (!(error instanceof LaWalletError)) return false;

  if (isMissingUser(error)) return true;
  if (error.status === 404 || error.code === 'NOT_FOUND') return true;
  return error.status === 403 || error.code === 'AUTHORIZATION_ERROR';
}

/**
 * Reads the service's error envelope.
 *
 * Every route answers failures as `{success: false, error: {message, code}}`,
 * so the useful sentence is nested two levels down. Surfacing the raw body
 * instead produces "[object Object]" in a toast, which is how an API with
 * perfectly good error messages ends up telling people nothing.
 */
function describeError(body: unknown, status: number): { message: string; code?: string } {
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;

    if (error && typeof error === 'object') {
      const { message, code } = error as { message?: unknown; code?: unknown };

      if (typeof message === 'string' && message) {
        return {
          message,
          code: typeof code === 'string' ? code : undefined,
        };
      }
    }
  }

  if (status === 401) return { message: 'Sign in again to continue.' };
  if (status === 409) return { message: 'That is already taken.' };
  if (status === 429) return { message: 'Too many requests — wait a moment.' };

  return { message: `The wallet service returned ${status}.` };
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** A session JWT from `POST /api/jwt`. */
  token?: string;
  /** Signs a NIP-98 header instead, for the routes that need one. */
  signer?: NostrSigner;
  signal?: AbortSignal;
}

export async function laWalletRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, token, signer, signal } = options;
  const url = `${LAWALLET_URL}${path}`;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (signer) {
    /**
     * The same NIP-98 helper the LNbits client uses. The service validates the
     * URL against what it actually received, so this has to be the absolute
     * one, and the payload has to be the body as sent.
     */
    headers.Authorization = await nip98Header(
      signer,
      url,
      method,
      body as Record<string, unknown> | undefined
    );
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const { message, code } = describeError(parsed, response.status);
    throw new LaWalletError(message, response.status, code);
  }

  return parsed as T;
}

/**
 * Usernames here are stricter than the ones this app issues itself.
 *
 * LaWallet allows `^[a-z0-9]+$` up to 16 characters — no dots, dashes or
 * underscores, which our own LNbits addresses do allow. Someone who already
 * has `first.last@ln.nostrfeed.com` cannot have the same name here, and
 * finding that out from a 400 after pressing the button is a poor way to
 * learn it.
 */
export const LAWALLET_MAX_USERNAME = 16;

export type LaWalletNameProblem =
  | 'empty'
  | 'too-long'
  | 'invalid-characters'
  | null;

export function validateLaWalletName(name: string): LaWalletNameProblem {
  if (!name) return 'empty';
  if (name.length > LAWALLET_MAX_USERNAME) return 'too-long';
  if (!/^[a-z0-9]+$/.test(name)) return 'invalid-characters';
  return null;
}

export function describeLaWalletNameProblem(problem: LaWalletNameProblem): string {
  switch (problem) {
    case 'empty':
      return 'Pick a name.';
    case 'too-long':
      return `At most ${LAWALLET_MAX_USERNAME} characters.`;
    case 'invalid-characters':
      return 'Lowercase letters and numbers only — no dots, dashes or underscores.';
    default:
      return '';
  }
}

/** Folds a name down to what this service will accept. */
export function suggestLaWalletName(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, LAWALLET_MAX_USERNAME);
}

/** The full address a name resolves to. */
export function laWalletAddress(
  username: string,
  domain: string = LAWALLET_DOMAIN
): string {
  return `${username}@${domain}`;
}

/**
 * The directory rows belonging to one key.
 *
 * `pubkey` is nullable in the schema — an address can exist with no key
 * attached — so a missing one must never match, or a signed-in person would
 * be handed every unclaimed address on the platform.
 */
export function addressesForPubkey(
  records: DirectoryAddress[],
  pubkey: string | undefined
): DirectoryAddress[] {
  if (!pubkey) return [];
  const key = pubkey.trim().toLowerCase();
  if (!key) return [];

  return records.filter(
    (record) => record.pubkey?.trim().toLowerCase() === key
  );
}

/**
 * What domain the service actually issues under, according to the service.
 *
 * Preferred over the configured fallback because an address printed with the
 * wrong domain is worse than no address: it looks right, it gets published to
 * a profile, and it silently resolves nowhere. Configuration drifts; this does
 * not.
 */
export function resolveIssuedDomain(
  records: DirectoryAddress[],
  fallback: string = LAWALLET_DOMAIN
): string {
  for (const record of records) {
    const domain = record.domain?.trim().replace(/^@/, '');
    if (domain) return domain;
  }

  return fallback;
}

/**
 * Everything this person holds on the platform, from both sources.
 *
 * The caller's own list is authoritative where the two overlap, since it is
 * the one carrying the settings. The directory contributes the addresses that
 * list does not know about — which is the whole point of consulting it, and
 * the reason someone who already had an address here stops being offered a
 * fresh one as though they had none.
 */
export function mergeHeldAddresses(
  managed: WalletAddress[],
  linked: DirectoryAddress[],
  fallbackDomain: string = LAWALLET_DOMAIN
): HeldAddress[] {
  const domain = resolveIssuedDomain(linked, fallbackDomain);
  const held = new Map<string, HeldAddress>();

  const add = (entry: DirectoryAddress) => {
    const name = entry.username?.trim().toLowerCase();
    if (!name) return;

    /**
     * The directory turns out to carry mode, destination and primary flag as
     * well as the key it is linked to, so an address found only there is
     * fully manageable rather than a name with nothing behind it.
     */
    const settings: WalletAddress | null = entry.mode
      ? {
          username: name,
          mode: entry.mode,
          redirect: entry.redirect ?? null,
          remoteWalletId: entry.remoteWalletId ?? null,
          isPrimary: entry.isPrimary,
        }
      : null;

    const existing = held.get(name);

    held.set(name, {
      username: name,
      domain,
      address: laWalletAddress(name, domain),
      // Never trade known settings for an entry that has none
      settings: settings ?? existing?.settings ?? null,
      isPrimary: entry.isPrimary ?? existing?.isPrimary ?? false,
      refusal: refusalReason(entry) ?? existing?.refusal ?? null,
    });
  };

  for (const entry of managed) add(entry);
  for (const entry of linked) add(entry);

  /**
   * Primary first, then alphabetically. Someone can hold dozens of these and
   * creation order is not an order anyone reads in — the address their money
   * actually arrives at belongs at the top.
   */
  return [...held.values()].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.username.localeCompare(b.username);
  });
}

/** A sentence for what an address currently does. */
export function describeMode(address: WalletAddress): string {
  switch (address.mode) {
    case 'ALIAS':
      return address.redirect
        ? `Forwards to ${address.redirect}`
        : 'Forwards elsewhere';
    case 'PROXY_ALIAS':
      return address.redirect
        ? `Forwards to ${address.redirect}, with zap receipts`
        : 'Forwards through the proxy';
    case 'CUSTOM_NWC':
      return 'Paid by your connected wallet';
    default:
      return 'Not pointed anywhere yet — it will refuse payments';
  }
}

/** Whether an address is actually able to receive money. */
export function isLive(address: WalletAddress): boolean {
  if (address.mode === 'CUSTOM_NWC') return !!address.remoteWalletId;
  if (address.mode === 'ALIAS' || address.mode === 'PROXY_ALIAS') {
    return !!address.redirect;
  }
  return false;
}

/** A pay-then-act invoice, as returned by `POST /api/invoices`. */
export interface ServiceInvoice {
  id: string;
  purpose: 'registration' | 'wallet-address';
  /** BOLT11. */
  pr: string;
  paymentHash: string;
  settled: boolean;
}

/**
 * Whether a refusal means "pay first" rather than "no".
 *
 * The service charges for names on some instances and not on others, and the
 * API has no endpoint that says which — the price only shows up as a refusal
 * when a name is claimed. So the refusal has to be read.
 *
 * Deliberately narrow. Treating any failure as payable would send someone to
 * a payment screen because a name was taken, which is worse than the error it
 * replaced: they would pay for nothing.
 */
export function requiresPayment(error: unknown): boolean {
  if (error instanceof LaWalletError) {
    // 402 is the unambiguous one; 403 is what an instance returns when the
    // route exists but this account has not paid for it
    if (error.status === 402) return true;
    if (error.code === 'PAYMENT_REQUIRED') return true;

    return (
      (error.status === 400 || error.status === 403) &&
      /pay|invoice|purchase|payment/i.test(error.message)
    );
  }

  return false;
}

/** Sats in a BOLT11, for showing a price before someone commits to it. */
export function invoiceAmountSats(bolt11: string): number | null {
  /**
   * The amount lives in the human-readable part, between the currency prefix
   * and the bech32 separator: digits and an optional multiplier letter. Read
   * here rather than with a decoder because the whole need is to show a
   * number next to a button, and a BOLT11 parser is a lot of bytes for one
   * label.
   *
   * The trailing `1` is that separator and is required by the match. Without
   * it, an amountless invoice — `lnbc1p3x...`, where the `1` *is* the
   * separator — parses as an amount of one whole bitcoin, and the button next
   * to it offers to pay 100,000,000 sats.
   */
  const match = /^ln(?:bcrt|bc|tb)(?:(\d+)([munp])?)?1/i.exec(bolt11.trim());
  if (!match || !match[1]) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  // BTC, then the multiplier, then to sats
  const scale: Record<string, number> = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 };
  const btc = value * (match[2] ? scale[match[2].toLowerCase()] : 1);

  return Math.round(btc * 100_000_000);
}
