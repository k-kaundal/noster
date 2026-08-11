import type { NostrEvent } from '@nostrify/nostrify';
import type { Proof } from '@cashu/cashu-ts';
import { parseProofs, toWireProofs, type WireProof } from '@/lib/cashu';

/**
 * NIP-60: a Cashu wallet kept on relays instead of only in a browser.
 *
 * Ecash is bearer money in local storage, which means clearing site data is
 * indistinguishable from being robbed. Publishing it — encrypted to yourself —
 * turns relays into the backup, and makes the same balance readable by any
 * other NIP-60 wallet the person uses.
 */

/** Replaceable wallet event: which mints, and the key for receiving nutzaps. */
export const WALLET_KIND = 17375;
/** An unspent set of proofs, encrypted to the owner. */
export const TOKEN_KIND = 7375;
/** Optional, informational record of a balance change. */
export const HISTORY_KIND = 7376;

/**
 * The unit proofs are denominated in when the payload does not say.
 *
 * NIP-60 makes `unit` optional and defines the default, which matters more
 * than it looks: a token event written by a dollar-denominated wallet carries
 * `"unit": "usd"`, and a reader that ignores the field adds those numbers to a
 * sats balance. The amounts are the same integers. Nothing about the arithmetic
 * would look wrong.
 */
export const DEFAULT_UNIT = 'sat';

/**
 * The half of a signer this file needs.
 *
 * Declared structurally rather than imported so that nothing here depends on
 * which signer implementation is in use — an extension, a bunker and a local
 * key all satisfy it.
 */
export interface Nip44Signer {
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

export interface WalletRecord {
  mints: string[];
  /** Key that nutzaps get locked to. Not used for spending. */
  privkey?: string;
}

export interface TokenRecord {
  mint: string;
  /** Lowercased, defaulted to `sat` when the payload omits it. */
  unit: string;
  proofs: Proof[];
  /** Token events this one replaces, so readers can ignore them. */
  del: string[];
  event: NostrEvent;
}

function requireNip44(signer: Nip44Signer): NonNullable<Nip44Signer['nip44']> {
  if (!signer.nip44) {
    throw new Error(
      'Your signer cannot encrypt. Update your Nostr extension to one that supports NIP-44.'
    );
  }

  return signer.nip44;
}

/**
 * Encrypts to yourself.
 *
 * NIP-44 to your own pubkey: only the key that wrote it can read it, and the
 * relay storing your balance learns nothing but that you have one.
 */
async function sealToSelf(
  signer: Nip44Signer,
  pubkey: string,
  payload: unknown
): Promise<string> {
  return requireNip44(signer).encrypt(pubkey, JSON.stringify(payload));
}

async function openFromSelf(
  signer: Nip44Signer,
  pubkey: string,
  ciphertext: string
): Promise<unknown> {
  const plaintext = await requireNip44(signer).decrypt(pubkey, ciphertext);
  return JSON.parse(plaintext) as unknown;
}

/**
 * The wallet event's content: an array of tag-shaped pairs, encrypted.
 *
 * Tags rather than an object because that is what NIP-60 specifies, and
 * because it lets a wallet list several mints without a schema change.
 */
export async function buildWalletContent(
  signer: Nip44Signer,
  pubkey: string,
  record: WalletRecord
): Promise<string> {
  const entries: string[][] = record.mints.map((mint) => ['mint', mint]);
  if (record.privkey) entries.unshift(['privkey', record.privkey]);

  return sealToSelf(signer, pubkey, entries);
}

export async function parseWalletEvent(
  signer: Nip44Signer,
  event: NostrEvent
): Promise<WalletRecord | null> {
  if (event.kind !== WALLET_KIND || !event.content) return null;

  try {
    const entries = await openFromSelf(signer, event.pubkey, event.content);
    if (!Array.isArray(entries)) return null;

    const pairs = entries.filter(
      (entry): entry is string[] =>
        Array.isArray(entry) && typeof entry[0] === 'string'
    );

    return {
      mints: pairs.filter(([key]) => key === 'mint').map(([, value]) => value),
      privkey: pairs.find(([key]) => key === 'privkey')?.[1],
    };
  } catch {
    // Written by a key we no longer hold, or by a client we can't read
    return null;
  }
}

interface TokenPayload {
  mint: string;
  unit: string;
  proofs: WireProof[];
  del: string[];
}

export async function buildTokenContent(
  signer: Nip44Signer,
  pubkey: string,
  mint: string,
  proofs: Proof[],
  del: string[],
  unit: string = DEFAULT_UNIT
): Promise<string> {
  const payload: TokenPayload = {
    mint,
    unit,
    proofs: toWireProofs(proofs),
    del,
  };

  return sealToSelf(signer, pubkey, payload);
}

export async function parseTokenEvent(
  signer: Nip44Signer,
  event: NostrEvent
): Promise<TokenRecord | null> {
  if (event.kind !== TOKEN_KIND || !event.content) return null;

  try {
    const payload = (await openFromSelf(
      signer,
      event.pubkey,
      event.content
    )) as Partial<TokenPayload> | null;

    if (!payload || typeof payload.mint !== 'string') return null;

    const proofs = parseProofs(payload.proofs);
    if (!proofs.length) return null;

    return {
      mint: payload.mint.replace(/\/+$/, ''),
      unit:
        typeof payload.unit === 'string' && payload.unit.trim()
          ? payload.unit.trim().toLowerCase()
          : DEFAULT_UNIT,
      proofs,
      del: Array.isArray(payload.del) ? payload.del.filter(isId) : [],
      event,
    };
  } catch {
    return null;
  }
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/**
 * Only the tokens this wallet can actually count.
 *
 * A wallet that adds up every token event it can decrypt will report a
 * dollar-denominated balance as sats, because the proofs carry bare integers
 * and the denomination lives in a field this used not to read. Filtering by
 * unit is what keeps a number on screen meaning what it says.
 */
export function tokensInUnit(
  records: TokenRecord[],
  unit: string = DEFAULT_UNIT
): TokenRecord[] {
  const wanted = unit.trim().toLowerCase();
  return records.filter((record) => record.unit === wanted);
}

/**
 * Which token events are still current.
 *
 * Every rewrite of the balance names the events it replaces in `del`, but the
 * old events stay on the relay — nothing forces a relay to honour a deletion
 * request. Skipping anything a later event has superseded is what keeps a
 * spent balance from reappearing.
 */
export function currentTokenEvents(records: TokenRecord[]): TokenRecord[] {
  const superseded = new Set(records.flatMap((record) => record.del));
  return records.filter((record) => !superseded.has(record.event.id));
}

export type Direction = 'in' | 'out';

export interface HistoryEntry {
  direction: Direction;
  /** Whole units, in `unit`. */
  amount: number;
  unit: string;
  /** Token event created by this change, when there was one. */
  created?: string;
  /** Token events destroyed by it. */
  destroyed: string[];
  /** Nutzaps redeemed, from the unencrypted tags. */
  redeemed: string[];
  createdAt: number;
  event: NostrEvent;
}

export interface HistoryInput {
  direction: Direction;
  amount: number;
  unit?: string;
  created?: string;
  destroyed?: string[];
  /** NIP-61 nutzaps this change redeemed. */
  redeemed?: string[];
}

/**
 * The encrypted half of a history event.
 *
 * Everything except `redeemed` markers: NIP-60 says to leave those in the
 * clear, because they are how anyone — including a later version of this
 * wallet — can tell that a given nutzap has already been claimed without
 * holding the key to read the rest. The amount and the direction are nobody
 * else's business and stay sealed.
 */
export async function buildHistoryContent(
  signer: Nip44Signer,
  pubkey: string,
  input: HistoryInput
): Promise<string> {
  const entries: string[][] = [
    ['direction', input.direction],
    ['amount', String(Math.trunc(input.amount))],
    ['unit', input.unit ?? DEFAULT_UNIT],
  ];

  if (input.created) entries.push(['e', input.created, '', 'created']);
  for (const id of input.destroyed ?? []) {
    entries.push(['e', id, '', 'destroyed']);
  }

  return sealToSelf(signer, pubkey, entries);
}

/** The tags that stay readable: redeemed nutzaps only. */
export function buildHistoryTags(input: HistoryInput): string[][] {
  return (input.redeemed ?? []).map((id) => ['e', id, '', 'redeemed']);
}

export async function parseHistoryEvent(
  signer: Nip44Signer,
  event: NostrEvent
): Promise<HistoryEntry | null> {
  if (event.kind !== HISTORY_KIND) return null;

  /**
   * Read before decrypting, and kept even if decryption fails. A history
   * event written by a client that sealed things differently is still proof
   * that its nutzaps were claimed, which is the one part that must not be
   * lost to an unreadable payload.
   */
  const redeemed = event.tags
    .filter(([name, id, , marker]) => name === 'e' && !!id && marker === 'redeemed')
    .map(([, id]) => id);

  let entries: string[][] = [];

  if (event.content) {
    try {
      const decrypted = await openFromSelf(signer, event.pubkey, event.content);
      if (Array.isArray(decrypted)) {
        entries = decrypted.filter(
          (entry): entry is string[] =>
            Array.isArray(entry) && typeof entry[0] === 'string'
        );
      }
    } catch {
      // Not ours to read, or written by a client we do not understand
    }
  }

  const value = (key: string) =>
    entries.find(([name]) => name === key)?.[1];

  const direction = value('direction');
  const amount = Number.parseInt(value('amount') ?? '', 10);

  // Without a direction and an amount there is no transaction to show, but a
  // redeemed marker alone is still worth surfacing to whoever tracks nutzaps
  if (direction !== 'in' && direction !== 'out') {
    return redeemed.length
      ? {
          direction: 'in',
          amount: 0,
          unit: DEFAULT_UNIT,
          destroyed: [],
          redeemed,
          createdAt: event.created_at,
          event,
        }
      : null;
  }

  const marked = (marker: string) =>
    entries
      .filter(([name, id, , mark]) => name === 'e' && !!id && mark === marker)
      .map(([, id]) => id);

  return {
    direction,
    amount: Number.isFinite(amount) ? amount : 0,
    unit: value('unit') ?? DEFAULT_UNIT,
    created: marked('created')[0],
    destroyed: marked('destroyed'),
    redeemed,
    createdAt: event.created_at,
    event,
  };
}
