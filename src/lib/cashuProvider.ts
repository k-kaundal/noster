import type { HistoryEntry } from '@/lib/nip60';
import type { CashuMovement } from '@/lib/cashuStore';
import type { WalletTransaction } from '@/lib/walletTransaction';

/**
 * Cashu, normalised into the wallet's one transaction shape.
 *
 * Two sources, and the order matters. The local movement log knows what each
 * action was, because it was written by the code doing it. The NIP-60 history
 * on relays knows only a direction and an amount — but it is the only record
 * of anything done on another device, so it fills the gaps rather than being
 * dropped.
 *
 * Where both describe the same movement the local one wins, since it is the
 * one that knows whether 10,000 sats was minted, melted, sent or received.
 */

export function movementToTransaction(
  movement: CashuMovement
): WalletTransaction {
  const outgoing =
    movement.type === 'cashu_melt' || movement.type === 'cashu_send';

  return {
    id: movement.id,
    type: movement.type,
    direction: outgoing ? 'outgoing' : 'incoming',
    amount: movement.amountSats,
    fee: movement.feeSats,
    status: movement.status,
    cashu: { mint: movement.mint, quoteId: movement.quoteId },
    lightning: movement.invoice ? { invoice: movement.invoice } : undefined,
    timestamp: movement.settledAt ?? movement.createdAt,
  };
}

/**
 * A NIP-60 history entry, which carries no type.
 *
 * Typed `unknown` rather than assumed to be a mint or a receive. A redeemed
 * nutzap is the one exception — that marker is in the event by design and says
 * what it was, so it is read rather than guessed.
 */
export function historyToTransaction(entry: HistoryEntry): WalletTransaction {
  const isNutzap = entry.redeemed.length > 0;

  return {
    id: entry.event.id,
    type: isNutzap ? 'zap' : 'unknown',
    direction: entry.direction === 'in' ? 'incoming' : 'outgoing',
    amount: entry.amount,
    status: 'settled',
    nostr: isNutzap ? { zapReceiptId: entry.redeemed[0] } : undefined,
    timestamp: entry.createdAt,
  };
}

/**
 * How close two movements have to be to be the same one.
 *
 * A local record and its NIP-60 counterpart are written seconds apart — the
 * event is published after the proofs are stored — so an exact timestamp match
 * would never fire and every movement would appear twice, once labelled and
 * once not.
 */
const SAME_MOVEMENT_SECONDS = 120;

/**
 * The Cashu history, labelled where possible and honest where not.
 *
 * A relay entry is dropped when a local movement already describes the same
 * amount and direction at about the same time; what survives is what happened
 * somewhere else, which shows as `unknown` because that is what is known about
 * it.
 */
export function cashuTransactions(
  movements: CashuMovement[],
  history: HistoryEntry[]
): WalletTransaction[] {
  const local = movements.map(movementToTransaction);

  const unmatched = history
    /**
     * Backfill entries carry a token for a send that was already recorded at
     * the time. They are not movements, and counting them would show the same
     * sats leaving twice.
     */
    .filter((entry) => !entry.isBackup)
    .map(historyToTransaction)
    .filter(
      (entry) =>
        !local.some(
          (known) =>
            known.direction === entry.direction &&
            known.amount === entry.amount &&
            Math.abs(known.timestamp - entry.timestamp) <= SAME_MOVEMENT_SECONDS
        )
    );

  return [...local, ...unmatched].sort((a, b) => b.timestamp - a.timestamp);
}
