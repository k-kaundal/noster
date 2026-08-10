import {
  Mint,
  Wallet,
  deserializeProofs,
  getEncodedToken,
  sumProofs,
  type GetInfoResponse,
  type Proof,
  type Token,
} from '@cashu/cashu-ts';

/**
 * Our Cashu mint.
 *
 * Ecash is the other half of the wallet story. The LNbits balance is an entry
 * in someone else's database with your name on it; ecash is a bearer token in
 * your browser that the mint cannot link back to you. Both are custodial in
 * the sense that the mint can vanish — the difference is what it knows about
 * you while it doesn't.
 */
export const CASHU_MINT_URL =
  import.meta.env.VITE_CASHU_MINT_URL?.replace(/\/+$/, '') ||
  'https://mint.nostrfeed.com';

/** The only unit this app deals in. Sats, like everything else here. */
export const CASHU_UNIT = 'sat';

/** Host of a mint URL, for showing people who is holding the money. */
export function mintHost(url: string = CASHU_MINT_URL): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * A loaded wallet for a mint, built once and reused.
 *
 * `loadMint` fetches the mint's info, keysets and keys — three requests before
 * anything can be signed. Doing that per operation would put a visible pause
 * in front of every button, so the promise is cached and shared.
 *
 * A failed load is not cached. A mint that was down when the page opened has
 * to be reachable again on the next attempt, not permanently written off.
 */
const loading = new Map<string, Promise<Wallet>>();

export function loadWallet(mintUrl: string = CASHU_MINT_URL): Promise<Wallet> {
  const existing = loading.get(mintUrl);
  if (existing) return existing;

  const pending = (async () => {
    const wallet = new Wallet(new Mint(mintUrl), { unit: CASHU_UNIT });
    await wallet.loadMint();
    return wallet;
  })().catch((error: unknown) => {
    loading.delete(mintUrl);
    throw error;
  });

  loading.set(mintUrl, pending);
  return pending;
}

/** The mint's NUT-06 `/v1/info`, without needing a loaded wallet. */
export function fetchMintInfo(
  mintUrl: string = CASHU_MINT_URL
): Promise<GetInfoResponse> {
  return new Mint(mintUrl).getInfo();
}

/** Total value of a set of proofs, in sats. */
export function proofsToSats(proofs: Proof[]): number {
  if (!proofs.length) return 0;
  return sumProofs(proofs).toNumber();
}

/**
 * Reads proofs back out of storage.
 *
 * Amounts are `Amount` objects in memory and plain strings once they have been
 * through JSON, so anything arriving from storage or from a relay has to come
 * back through here before the library will accept it.
 */
export function parseProofs(raw: unknown): Proof[] {
  if (!raw) return [];

  try {
    return deserializeProofs(
      raw as Parameters<typeof deserializeProofs>[0]
    ).filter((proof) => !!proof.secret && !!proof.C);
  } catch {
    // Corrupt storage is not worth crashing a wallet over. The Nostr backup
    // and the mint's own state are the recovery path.
    return [];
  }
}

/**
 * Combines proof sets, keeping one of each.
 *
 * The same proof legitimately arrives from two places at once — local storage
 * and the Nostr backup — and a proof counted twice is a balance that lies.
 * `secret` is the identity: it is what the mint marks as spent.
 */
export function mergeProofs(...groups: Proof[][]): Proof[] {
  const bySecret = new Map<string, Proof>();

  for (const group of groups) {
    for (const proof of group) {
      if (!bySecret.has(proof.secret)) bySecret.set(proof.secret, proof);
    }
  }

  return [...bySecret.values()];
}

/** Proofs from `a` that are not in `b`, compared by secret. */
export function withoutProofs(a: Proof[], b: Iterable<string>): Proof[] {
  const drop = new Set(b);
  return a.filter((proof) => !drop.has(proof.secret));
}

/** A proof as everyone else writes it down: amount as a plain number. */
export interface WireProof {
  id: string;
  amount: number;
  secret: string;
  C: string;
  dleq?: unknown;
  witness?: unknown;
}

/**
 * Proofs in the shape the rest of the world stores them.
 *
 * This library models amounts as an `Amount` object, and `JSON.stringify`
 * turns those into strings. That round-trips through our own storage fine, but
 * NIP-60 backups are read by other wallets, and a token whose amount is
 * `"21"` instead of `21` is one they will reject. Numbers here, always.
 */
export function toWireProofs(proofs: Proof[]): WireProof[] {
  return proofs.map((proof) => ({
    ...proof,
    amount: proof.amount.toNumber(),
  }));
}

/** Serialises proofs as a `cashuB` token string, ready to hand to someone. */
export function encodeToken(
  proofs: Proof[],
  mintUrl: string = CASHU_MINT_URL,
  memo?: string
): string {
  const token: Token = {
    mint: mintUrl,
    proofs,
    unit: CASHU_UNIT,
    ...(memo ? { memo } : {}),
  };

  return getEncodedToken(token);
}

/** Whether a pasted string looks like a Cashu token at all. */
export function looksLikeToken(value: string): boolean {
  return /^cashu[AB]/i.test(value.trim());
}

/**
 * Drops proofs the mint has already marked spent.
 *
 * Needed because relays keep old backups: a token event superseded on this
 * device is still sitting on a relay, and every one of its proofs would be
 * added back to the balance on the next load. Asking the mint is the only
 * authority on which of them are still money.
 *
 * On a mint that cannot be reached the set is returned untouched. Showing a
 * balance that might be stale beats emptying a wallet because of a timeout.
 */
export async function dropSpentProofs(
  proofs: Proof[],
  mintUrl: string = CASHU_MINT_URL
): Promise<Proof[]> {
  if (!proofs.length) return proofs;

  try {
    const wallet = await loadWallet(mintUrl);
    const { unspent, pending } = await wallet.groupProofsByState(proofs);

    // Pending means in flight in a melt the mint hasn't settled. It is not
    // spendable now but it is not gone either, so it is kept and rechecked.
    return mergeProofs(unspent, pending);
  } catch {
    return proofs;
  }
}
