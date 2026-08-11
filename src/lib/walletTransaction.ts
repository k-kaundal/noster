/**
 * One shape for everything the wallet has done.
 *
 * The wallet grew several independent payment paths — zaps, pay links, Cashu
 * minting and melting, ecash handed over directly, NWC — and each knew exactly
 * what it was doing while it did it, then threw that away. What reached the
 * history was an amount and a direction, so the UI could only say "+1,000
 * sats" where it should say which of those happened, with whom, and about
 * what.
 *
 * This is the model the UI reads. Nothing above it knows whether a row came
 * from a mint, a pay link or a connected wallet — the providers normalise into
 * this, and the cards render it.
 *
 * The one rule that keeps it honest: a row's `type` is recorded by whichever
 * path created it, never inferred afterwards from a settlement that any of
 * them could have produced. A payment shown with the wrong reason is worse
 * than one shown with none, so anything unmatched says so.
 */

export type TransactionType =
  | 'zap'
  | 'lightning'
  | 'cashu_mint'
  | 'cashu_melt'
  | 'cashu_send'
  | 'cashu_receive'
  /** Settled, but nothing on this device recorded why. Never a guess. */
  | 'unknown';

export type TransactionDirection = 'incoming' | 'outgoing';

export type TransactionStatus = 'pending' | 'settled' | 'failed';

export interface TransactionParty {
  pubkey?: string;
  name?: string;
  avatar?: string;
  /** Lightning address, when the payment had one on this side. */
  address?: string;
}

export interface WalletTransaction {
  id: string;
  type: TransactionType;
  direction: TransactionDirection;

  /** Satoshis. Always the amount that moved, not the amount quoted. */
  amount: number;
  fee?: number;

  status: TransactionStatus;

  sender?: TransactionParty;
  receiver?: TransactionParty;

  lightning?: {
    paymentHash?: string;
    invoice?: string;
    address?: string;
  };

  cashu?: {
    mint?: string;
    quoteId?: string;
  };

  nostr?: {
    eventId?: string;
    zapReceiptId?: string;
    /** The zapper's message, which is the point of a zap. */
    comment?: string;
  };

  timestamp: number;
}

/**
 * Balances, kept apart.
 *
 * A total is what someone wants to see, but ecash and lightning are not the
 * same money: ecash is bearer tokens from one mint, and spending it anywhere
 * else means melting it first. Merging them into a single number and nothing
 * else would tell somebody they have 19,541 sats to pay an invoice with when
 * only part of it can go.
 */
export interface WalletBalance {
  lightning: number;
  cashu: number;
  total: number;
}

export function combineBalance(lightning: number, cashu: number): WalletBalance {
  return { lightning, cashu, total: lightning + cashu };
}

/**
 * What a wallet backend has to answer.
 *
 * Deliberately small. Each provider owns one backend and the differences stay
 * inside it — the list above never learns that Cashu has quotes or that NWC
 * has a connection string.
 */
export interface WalletProvider {
  id: string;
  label: string;
  getBalance(): Promise<number>;
  getTransactions(): Promise<WalletTransaction[]>;
}

export interface TransactionLabel {
  title: string;
  /** The second line: who, which mint, where it went. */
  detail?: string;
  icon: 'zap' | 'lightning' | 'ecash';
}

export function describeTransaction(
  transaction: WalletTransaction
): TransactionLabel {
  const incoming = transaction.direction === 'incoming';

  switch (transaction.type) {
    case 'zap':
      return {
        icon: 'zap',
        title: incoming ? 'Zap received' : 'Zap sent',
        detail:
          (incoming ? transaction.sender : transaction.receiver)?.name ??
          (transaction.nostr?.eventId ? 'on a note' : undefined),
      };

    case 'lightning':
      return {
        icon: 'lightning',
        title: incoming ? 'Lightning received' : 'Lightning sent',
        detail:
          transaction.lightning?.address ??
          (incoming ? transaction.sender : transaction.receiver)?.address,
      };

    case 'cashu_mint':
      return {
        icon: 'ecash',
        title: 'Ecash minted',
        detail: mintHost(transaction.cashu?.mint),
      };

    case 'cashu_melt':
      return {
        icon: 'ecash',
        title: 'Ecash to Lightning',
        detail: mintHost(transaction.cashu?.mint),
      };

    case 'cashu_send':
      return {
        icon: 'ecash',
        title: 'Ecash sent',
        detail: mintHost(transaction.cashu?.mint),
      };

    case 'cashu_receive':
      return {
        icon: 'ecash',
        title: 'Ecash received',
        detail: mintHost(transaction.cashu?.mint),
      };

    default:
      return {
        icon: 'lightning',
        title: incoming ? 'Received' : 'Sent',
        /**
         * Said outright. This is a movement whose reason was never recorded —
         * usually made from another device or another client — and inventing
         * one for it is the exact failure this model exists to stop.
         */
        detail: 'reason not recorded on this device',
      };
  }
}

function mintHost(url: string | undefined): string | undefined {
  if (!url) return undefined;

  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Whether a type moves ecash rather than lightning. */
export function isEcash(type: TransactionType): boolean {
  return type.startsWith('cashu_');
}

/**
 * Merges providers' lists into one history.
 *
 * Deduplicated on id, because the same movement can be seen twice: melting
 * ecash to pay an invoice is one act that the Cashu side and the lightning
 * side would each report. Newest first.
 */
export function mergeTransactions(
  lists: WalletTransaction[][]
): WalletTransaction[] {
  const byId = new Map<string, WalletTransaction>();

  for (const list of lists) {
    for (const transaction of list) {
      const existing = byId.get(transaction.id);

      // A settled view of a movement beats a pending one from another source
      if (!existing || (existing.status !== 'settled' && transaction.status === 'settled')) {
        byId.set(transaction.id, transaction);
      }
    }
  }

  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
}
