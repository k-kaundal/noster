import type { NostrSigner } from '@nostrify/nostrify';
import { nip98Header } from '@/lib/lnbits';
import { relayHttpUrl } from '@/lib/relay';

/**
 * NIP-86: the relay management API.
 *
 * JSON-RPC over HTTP to the same URI the websocket lives on, told apart by a
 * `Content-Type` of `application/nostr+json+rpc`. Every call is authorised
 * with a NIP-98 event whose `payload` tag is required — normally optional, but
 * here the body is the whole instruction, and a signature that does not cover
 * it authorises "some request to this relay" rather than "ban this person".
 *
 * Almost everything this file can do is done to somebody: banning a key,
 * blocking an address, taking down an event. So nothing here is called
 * speculatively, `supportedmethods` decides what is even offered, and the
 * destructive calls are wired to a confirmation in the UI rather than to a
 * button.
 */

export const RPC_CONTENT_TYPE = 'application/nostr+json+rpc';

export type ManagementMethod =
  | 'supportedmethods'
  | 'banpubkey'
  | 'unbanpubkey'
  | 'listbannedpubkeys'
  | 'allowpubkey'
  | 'unallowpubkey'
  | 'listallowedpubkeys'
  | 'createrole'
  | 'editrole'
  | 'deleterole'
  | 'assignrole'
  | 'unassignrole'
  | 'listeventsneedingmoderation'
  | 'allowevent'
  | 'banevent'
  | 'listbannedevents'
  | 'changerelayname'
  | 'changerelaydescription'
  | 'changerelayicon'
  | 'allowkind'
  | 'disallowkind'
  | 'listallowedkinds'
  | 'blockip'
  | 'unblockip'
  | 'listblockedips';

export interface BannedPubkey {
  pubkey: string;
  reason?: string;
}

export interface ModeratedEvent {
  id: string;
  reason?: string;
}

export interface BlockedIp {
  ip: string;
  reason?: string;
}

export class RelayManagementError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly method?: ManagementMethod
  ) {
    super(message);
    this.name = 'RelayManagementError';
  }
}

/** Whether a failure means "you are not an administrator here". */
export function isUnauthorised(error: unknown): boolean {
  return error instanceof RelayManagementError && error.status === 401;
}

/**
 * Whether a failure means the relay has no management API at all.
 *
 * Told apart from a refusal because they call for opposite responses: an
 * unsupported relay should silently offer nothing, while a 401 means the
 * feature exists and this key is not allowed to use it.
 */
export function isUnsupported(error: unknown): boolean {
  if (!(error instanceof RelayManagementError)) return true;

  /**
   * No status means the request never got an answer — almost always a relay
   * with no management endpoint and so no CORS headers for one, which the
   * browser reports as a network failure indistinguishable from being
   * offline. Counted as unsupported, because the alternative is every reader
   * seeing an error on every relay that simply does not offer this.
   */
  if (error.status === undefined) return true;

  return error.status === 404 || error.status === 405 || error.status === 415;
}

/**
 * One JSON-RPC call.
 *
 * The `u` tag is the HTTP URL being requested rather than the `wss://` form.
 * NIP-86 calls it "the relay URL" and NIP-98 requires the absolute URL of the
 * request; they are the same URI modulo scheme, and a relay validating the
 * NIP-98 event compares it against what its HTTP server received.
 */
export async function relayRpc<T>(
  relayUrl: string,
  signer: NostrSigner,
  method: ManagementMethod,
  params: unknown[] = [],
  signal?: AbortSignal
): Promise<T> {
  const url = relayHttpUrl(relayUrl);
  const body = { method, params };

  const authorization = await nip98Header(
    signer,
    url,
    'POST',
    body as unknown as Record<string, unknown>
  );

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': RPC_CONTENT_TYPE,
        Accept: RPC_CONTENT_TYPE,
        Authorization: authorization,
      },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(10000),
    });
  } catch (error) {
    /**
     * A relay serving no management API usually has no CORS headers for it
     * either, and the browser reports that as a network failure rather than a
     * status. Indistinguishable from being offline from here, so it is
     * reported as unsupported — which is the assumption that shows nothing
     * rather than the one that shows a broken panel.
     */
    throw new RelayManagementError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'The relay did not answer in time.'
        : 'Could not reach this relay’s management API.',
      undefined,
      method
    );
  }

  if (response.status === 401) {
    throw new RelayManagementError(
      'This relay does not recognise your key as an administrator.',
      401,
      method
    );
  }

  if (!response.ok) {
    throw new RelayManagementError(
      `The relay returned ${response.status}.`,
      response.status,
      method
    );
  }

  let payload: { result?: unknown; error?: unknown };

  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new RelayManagementError(
      'The relay answered with something that was not JSON.',
      response.status,
      method
    );
  }

  /**
   * An error can arrive alongside a 200 — the protocol carries failure in the
   * body, not the status. Checked before the result, since a relay that
   * reports "not permitted" and a `result` of null would otherwise read as a
   * call that worked.
   */
  if (typeof payload.error === 'string' && payload.error.trim()) {
    throw new RelayManagementError(payload.error.trim(), response.status, method);
  }

  return payload.result as T;
}

/** Methods the relay says it implements, lowercased. */
export async function supportedMethods(
  relayUrl: string,
  signer: NostrSigner,
  signal?: AbortSignal
): Promise<ManagementMethod[]> {
  const result = await relayRpc<unknown>(
    relayUrl,
    signer,
    'supportedmethods',
    [],
    signal
  );

  if (!Array.isArray(result)) return [];

  return result
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase() as ManagementMethod);
}

function asList<T>(value: unknown, pick: (entry: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null
    )
    .map(pick)
    .filter((entry): entry is T => entry !== null);
}

export function parsePubkeyList(value: unknown): BannedPubkey[] {
  return asList(value, (entry) =>
    typeof entry.pubkey === 'string' && entry.pubkey
      ? {
          pubkey: entry.pubkey,
          reason:
            typeof entry.reason === 'string' && entry.reason.trim()
              ? entry.reason.trim()
              : undefined,
        }
      : null
  );
}

export function parseEventList(value: unknown): ModeratedEvent[] {
  return asList(value, (entry) =>
    typeof entry.id === 'string' && entry.id
      ? {
          id: entry.id,
          reason:
            typeof entry.reason === 'string' && entry.reason.trim()
              ? entry.reason.trim()
              : undefined,
        }
      : null
  );
}

export function parseIpList(value: unknown): BlockedIp[] {
  return asList(value, (entry) =>
    typeof entry.ip === 'string' && entry.ip
      ? {
          ip: entry.ip,
          reason:
            typeof entry.reason === 'string' && entry.reason.trim()
              ? entry.reason.trim()
              : undefined,
        }
      : null
  );
}

export function parseKindList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => (typeof entry === 'number' ? entry : Number.parseInt(String(entry), 10)))
    .filter((entry) => Number.isInteger(entry) && entry >= 0)
    .sort((a, b) => a - b);
}

/**
 * Methods that do something to somebody, and so need confirming.
 *
 * Kept as data rather than decided at each call site: the list is the whole
 * point, and a new destructive method added to a component's `onClick` should
 * not be able to skip the check by being written somewhere else.
 */
export const DESTRUCTIVE_METHODS = new Set<ManagementMethod>([
  'banpubkey',
  'unallowpubkey',
  'banevent',
  'blockip',
  'deleterole',
  'unassignrole',
  'disallowkind',
]);

export function isDestructive(method: ManagementMethod): boolean {
  return DESTRUCTIVE_METHODS.has(method);
}
