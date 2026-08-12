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

/**
 * The same, for a response that is one record rather than a list.
 *
 * `unwrapList` exists because the schema promises `{data: [...]}` and the
 * service answers with a bare array. Single records are the same problem in
 * the other direction — some routes wrap, some do not — and reading only one
 * shape means every field arrives `undefined`, which is not an error anywhere
 * until something calls a method on one.
 *
 * Only `data` is unwrapped. Guessing at other envelope names would risk
 * mistaking a record's own nested object for the record.
 */
export function unwrapRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};

  const record = body as Record<string, unknown>;
  const nested = record.data;

  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }

  return record;
}

/** The first of these fields that carries a non-empty string. */
function firstString(
  record: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
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
    readonly code?: string,
    /**
     * What the server actually said, when that differs from `message`.
     *
     * A 500 arrives carrying whatever leaked out of the layer that broke —
     * this service has answered with a raw Prisma invocation dump — and that
     * belongs nowhere near a toast. `message` is what a person is shown;
     * `detail` is kept so code can still recognise the specific failure and
     * so it survives into the console.
     */
    readonly detail?: string
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

/**
 * Whether the service refused to issue an invoice because it already has one.
 *
 * The failure arrives as a 500 carrying an ORM message — a unique-constraint
 * violation on `paymentHash` — which is the service trying to insert a second
 * row for a BOLT11 its node handed back unchanged. Asking again produces the
 * same collision, so this is not a retry case; it is a case for using the
 * invoice already issued.
 *
 * Matched on the detail rather than the code, because the code is the generic
 * `INTERNAL_SERVER_ERROR` that every unhandled failure carries.
 */
export function isDuplicateInvoice(error: unknown): boolean {
  if (!(error instanceof LaWalletError)) return false;

  const detail = error.detail ?? '';
  return /unique constraint/i.test(detail) && /paymenthash/i.test(detail);
}

/**
 * Invoices this browser has been issued, kept so they are not asked for twice.
 *
 * Written straight to storage rather than through `useLocalStorage`, for the
 * reason `cashuStore` does the same: these are read and written inside
 * mutations, where a state snapshot taken at mount is exactly the stale value
 * that would lose one.
 *
 * Worth keeping at all because the service will not reissue. Once it has
 * handed out an invoice for a name, a second request collides on the payment
 * hash and fails — so a copy that was only ever held in memory becomes a bill
 * that cannot be paid and a name that cannot be bought, for as long as the
 * original takes to expire.
 */
const QUOTE_KEY = 'lawallet:quotes';

export interface StoredQuote {
  invoice: ServiceInvoice;
  /** Epoch milliseconds, from this browser. */
  issuedAt: number;
}

/**
 * How long an unpaid invoice is offered again without asking for a new one.
 *
 * Well inside the hour BOLT11 invoices usually allow. Being early costs one
 * request; being late offers somebody an invoice their wallet will reject as
 * expired, which reads as the payment failing.
 */
export const QUOTE_FRESH_MS = 30 * 60_000;

function quoteSlot(pubkey: string, username: string): string {
  return `${pubkey}:${username.toLowerCase()}`;
}

function readQuotes(): Record<string, StoredQuote> {
  try {
    const raw = localStorage.getItem(QUOTE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeQuotes(quotes: Record<string, StoredQuote>): void {
  try {
    localStorage.setItem(QUOTE_KEY, JSON.stringify(quotes));
  } catch {
    // A full or blocked store costs a re-request, not correctness
  }
}

export function rememberQuote(
  pubkey: string,
  username: string,
  invoice: ServiceInvoice,
  now = Date.now()
): void {
  const quotes = readQuotes();
  quotes[quoteSlot(pubkey, username)] = { invoice, issuedAt: now };
  writeQuotes(quotes);
}

export function recallQuote(
  pubkey: string,
  username: string
): StoredQuote | null {
  const held = readQuotes()[quoteSlot(pubkey, username)];
  if (!held) return null;

  /**
   * Read back through the same boundary as a fresh response.
   *
   * Storage holds whatever the service sent on the day it was written, which
   * is not necessarily what this build expects — and an invoice saved before
   * `bolt11` was understood would otherwise come back with no payment request
   * and fail exactly where it failed the first time. Normalising here also
   * rescues those: the payment request was always in the record, only under a
   * name nothing was reading.
   */
  const invoice = readStoredInvoice(held.invoice);
  if (!invoice) return null;

  return { invoice, issuedAt: held.issuedAt };
}

export function forgetQuote(pubkey: string, username: string): void {
  const quotes = readQuotes();
  delete quotes[quoteSlot(pubkey, username)];
  writeQuotes(quotes);
}

/**
 * Whether a held invoice is past being worth offering again.
 *
 * The service states an `expiresAt`, and where it does that is the answer —
 * a guess cannot beat the issuer on its own invoice. The window below is the
 * fallback for a response that carries no expiry, and it is deliberately well
 * short of the hour BOLT11 invoices usually allow: being early costs one
 * request, being late offers somebody a bill their wallet rejects, which
 * reads as the payment failing rather than as the bill being old.
 *
 * A small margin comes off the stated expiry for the same reason. An invoice
 * that expires while the payment is in flight fails in a way nobody can tell
 * apart from a broken wallet.
 */
export function isQuoteStale(quote: StoredQuote, now = Date.now()): boolean {
  const expiry = quote.invoice.expiresAt
    ? Date.parse(quote.invoice.expiresAt)
    : NaN;

  if (!Number.isNaN(expiry)) return now > expiry - 60_000;

  return now - quote.issuedAt > QUOTE_FRESH_MS;
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
function describeError(
  body: unknown,
  status: number
): { message: string; code?: string; detail?: string } {
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;

    if (error && typeof error === 'object') {
      const { message, code } = error as { message?: unknown; code?: unknown };

      if (typeof message === 'string' && message) {
        /**
         * A 500 is never something the reader can act on, and the text is
         * whatever escaped the layer that broke. This one has answered with
         * an ORM stack dump — "Invalid `prisma.invoice.create()` invocation:
         * Unique constraint failed on the fields: (`paymentHash`)" — which is
         * a database schema shown to somebody who was trying to buy a name.
         *
         * Kept as `detail` rather than dropped, so the specific failure is
         * still recognisable in code and still readable in the console.
         */
        if (status >= 500) {
          return {
            message:
              'The wallet service hit an error on its side. Nothing is wrong with what you entered.',
            code: typeof code === 'string' ? code : undefined,
            detail: message,
          };
        }

        return {
          message,
          code: typeof code === 'string' ? code : undefined,
          detail: message,
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
    const { message, code, detail } = describeError(parsed, response.status);
    throw new LaWalletError(message, response.status, code, detail);
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
  /**
   * BOLT11.
   *
   * Named `pr` because that is what the schema calls it. The service sends it
   * as `bolt11`, so nothing may read this field off a raw response — see
   * `readInvoice`, which is the only thing that should build one of these.
   */
  pr: string;
  paymentHash: string;
  /**
   * What it costs, as the service states it.
   *
   * Preferred over reading the amount out of the BOLT11 ourselves. Both should
   * agree, and where they might not, the number the service put in writing is
   * the one to show next to a button that spends money.
   */
  amountSats?: number | null;
  /** ISO 8601, when the service says the invoice stops being payable. */
  expiresAt?: string;
  /**
   * LUD-21 verification URL, which is what makes paying from elsewhere
   * possible at all.
   *
   * Claiming the name needs the preimage, and a wallet outside this app never
   * hands one back. This URL is the service telling us where to ask instead —
   * so an invoice scanned onto a phone can still be proven here.
   */
  verify?: string;
  purpose?: 'registration' | 'wallet-address';
  settled?: boolean;
}

/**
 * Reads an invoice response, whatever the service decided to call the fields.
 *
 * The schema documents `pr`; the service sends `bolt11`, plus an `amountSats`
 * and an `expiresAt` that the schema does not mention at all. Reading only the
 * documented name left `pr` undefined, and nothing noticed until the amount
 * parser called `.trim()` on it — so a mismatch between two field names
 * reached the reader as "Cannot read properties of undefined" on the screen
 * where they were buying a name.
 *
 * Which is the argument for this function existing rather than a wider type:
 * the shape is checked once, at the boundary, and everything past it holds an
 * invoice that is known to have a payment request in it.
 */
export function readInvoice(body: unknown): ServiceInvoice {
  const record = unwrapRecord(body);

  const pr = firstString(record, [
    'bolt11',
    'pr',
    'payment_request',
    'paymentRequest',
  ]);

  if (!pr) {
    throw new LaWalletError(
      'The wallet service returned an invoice with no payment request in it, so there is nothing to pay.',
      200
    );
  }

  const id = firstString(record, ['id', 'invoiceId', 'invoice_id']);

  if (!id) {
    /**
     * Refused rather than carried. Claiming the name afterwards is
     * `POST /api/invoices/{id}/claim`, so an invoice with no id can be paid
     * and then proves nothing — which is the one failure worth stopping
     * before the money moves rather than after.
     */
    throw new LaWalletError(
      'The wallet service returned an invoice with no id, which means a payment could not be proven afterwards.',
      200
    );
  }

  const amount = record.amountSats;

  return {
    id,
    pr,
    paymentHash: firstString(record, ['paymentHash', 'payment_hash']) ?? '',
    amountSats:
      typeof amount === 'number' && Number.isFinite(amount)
        ? amount
        : invoiceAmountSats(pr),
    expiresAt: firstString(record, ['expiresAt', 'expires_at']),
    verify: firstString(record, ['verify', 'verifyUrl']),
    purpose: record.purpose as ServiceInvoice['purpose'],
    settled: record.settled === true,
  };
}

/** What LUD-21 says about a payment when asked. */
export interface PaymentVerification {
  settled: boolean;
  /** Proof of payment, which is the whole reason to ask. */
  preimage?: string;
}

/**
 * Reads a LUD-21 verify response.
 *
 * The schema documents only `{status}`, which would make this useless — but
 * the schema also documented the payment request as `pr` when the service
 * sends `bolt11`, so the spec is treated here as a floor rather than a
 * description. LUD-21 itself defines `settled` and `preimage`, and the
 * service publishes a verify URL on every invoice, which it would have no
 * reason to do if it answered with neither.
 *
 * A preimage is taken as proof on its own. LUD-21 holds it back until the
 * payment settles, so its presence cannot mean anything else.
 */
export function readVerification(body: unknown): PaymentVerification {
  const record = unwrapRecord(body);
  const preimage = firstString(record, ['preimage']);

  return {
    settled: record.settled === true || record.paid === true || !!preimage,
    preimage,
  };
}

/**
 * Asks whether an invoice has been paid, and for the proof if it has.
 *
 * Public — no signature, no session — because the URL already names the one
 * payment it can speak about. Fetched directly rather than through
 * `laWalletRequest`, since the service gives the URL absolute and on a
 * different host than the API.
 */
export async function verifyPayment(
  url: string,
  signal?: AbortSignal
): Promise<PaymentVerification> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new LaWalletError(
      'Could not check whether that invoice has been paid.',
      response.status
    );
  }

  return readVerification(await response.json());
}

/**
 * Reads an address record back from a write, with the name asked for as the
 * fallback.
 *
 * Same boundary as `readInvoice`, and here for the same reason: the invoice
 * route renamed a field the schema documents, so this one may too. The cost of
 * being wrong is smaller but not nothing — the success toast says "{name} is
 * yours", and an undefined there tells somebody their name is `undefined`.
 */
export function readWalletAddress(
  body: unknown,
  fallbackUsername: string
): WalletAddress {
  const record = unwrapRecord(body);
  const mode = record.mode;

  return {
    username: firstString(record, ['username', 'name']) ?? fallbackUsername,
    mode: (typeof mode === 'string' ? mode : 'IDLE') as AddressMode,
    redirect: typeof record.redirect === 'string' ? record.redirect : null,
    remoteWalletId:
      typeof record.remoteWalletId === 'string' ? record.remoteWalletId : null,
    isPrimary: record.isPrimary === true,
  };
}

/**
 * The same, for an invoice coming back out of storage rather than off the
 * wire. Answers null instead of throwing, since a stored record that cannot
 * be read is simply one to forget.
 */
export function readStoredInvoice(body: unknown): ServiceInvoice | null {
  try {
    return readInvoice(body);
  } catch {
    return null;
  }
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
  // Guarded rather than trusted. A missing field used to reach here as
  // `undefined.trim()`, which surfaced to the reader as "Cannot read
  // properties of undefined" on the screen where they were buying a name
  if (typeof bolt11 !== 'string') return null;

  const match = /^ln(?:bcrt|bc|tb)(?:(\d+)([munp])?)?1/i.exec(bolt11.trim());
  if (!match || !match[1]) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  // BTC, then the multiplier, then to sats
  const scale: Record<string, number> = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 };
  const btc = value * (match[2] ? scale[match[2].toLowerCase()] : 1);

  return Math.round(btc * 100_000_000);
}
