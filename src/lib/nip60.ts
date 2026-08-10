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
  proofs: WireProof[];
  del: string[];
}

export async function buildTokenContent(
  signer: Nip44Signer,
  pubkey: string,
  mint: string,
  proofs: Proof[],
  del: string[]
): Promise<string> {
  const payload: TokenPayload = { mint, proofs: toWireProofs(proofs), del };
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
