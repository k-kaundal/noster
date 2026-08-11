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

/**
 * What this mint charges to spend a proof, in parts per thousand.
 *
 * NUT-02 lets a mint set `input_fee_ppk` per keyset, charged on every proof
 * used as an input — so sending, receiving and paying an invoice all cost
 * something, and a balance quietly shrinks as it is used. Whether that is
 * happening is not visible anywhere else in the app, and a wallet that loses
 * sats for reasons the person cannot see is indistinguishable from one that
 * is broken.
 *
 * Read from the active keysets, since those are the ones new money is issued
 * on. Zero, and the absent case, both mean free.
 */
export function activeInputFeePpk(keysets: KeysetSummary[]): number {
  return keysets
    .filter((keyset) => keyset.isActive && keyset.unit === CASHU_UNIT)
    .reduce((highest, keyset) => Math.max(highest, keyset.fee || 0), 0);
}

/** The fields of a NUT-02 keyset this app reads. */
export interface KeysetSummary {
  unit: string;
  isActive: boolean;
  /** `input_fee_ppk`, as the library names it. */
  fee: number;
}

/**
 * The fee for spending `inputs` proofs, in sats.
 *
 * NUT-02: sum the per-input fee and round up to the next whole unit, so
 * 100 ppk costs 1 sat for anything from 1 to 10 inputs. Integer arithmetic
 * because the spec says so — floating point division here rounds unpredictably
 * at the boundaries, and the boundary is where the mint's answer and ours have
 * to agree.
 */
export function inputFeeSats(inputs: number, feePpk: number): number {
  if (inputs <= 0 || feePpk <= 0) return 0;
  return Math.floor((inputs * feePpk + 999) / 1000);
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

/**
 * The proofs a swap consumed.
 *
 * `wallet.send` does not slice a set in two — it spends inputs at the mint and
 * gets fresh proofs back, and it decides for itself which inputs it needed. So
 * the originals it used are gone, spent, and nothing this wallet can do will
 * bring them back, but they are neither in `keep` nor in what was sent.
 *
 * They have to be recorded as used or they come back. Relays still hold the
 * backup they were part of, and a backup is restored by counting its proofs —
 * so on the next device, or after the next reload, a balance that was already
 * spent gets added to the one that replaced it. The mint's spent-check catches
 * it eventually, which is why this looked like a balance that wobbled rather
 * than one that was wrong.
 */
export function consumedProofs(before: Proof[], ...survivors: Proof[][]): Proof[] {
  const kept = new Set(survivors.flat().map((proof) => proof.secret));
  return before.filter((proof) => !kept.has(proof.secret));
}

/**
 * Folds a reconciliation back together with whatever landed while it ran.
 *
 * Reading the balance is slow — a relay query, decrypting each backup, then
 * asking the mint which proofs are still money — and a deposit can complete in
 * the middle of it. The read then finished with a set computed before that
 * deposit existed and wrote it to storage, erasing proofs that had just been
 * minted. Money went in and the balance went down.
 *
 * So the read is folded rather than assigned. Anything in storage now is
 * included even though this pass never saw it, and anything recorded as spent
 * now is excluded even though this pass thought it was good. Both lists are
 * re-read at the end for exactly that reason: at the start they were a
 * different answer to a different question.
 *
 * The newcomers skip the mint's spent-check, which is safe in the direction
 * that matters — they were minted or received seconds ago, and the next pass
 * checks them anyway. Counting a spent proof for thirty seconds is a wrong
 * balance; dropping an unspent one is lost money.
 */
export function foldConcurrentChanges(
  checked: Proof[],
  storedNow: Proof[],
  usedNow: Iterable<string>
): Proof[] {
  return withoutProofs(mergeProofs(checked, storedNow), usedNow);
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
