import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { cashuTransactions } from './cashuProvider';
import type { CashuMovement } from './cashuStore';
import type { HistoryEntry } from './nip60';

const MINT = 'https://mint.example';

function movement(overrides: Partial<CashuMovement> = {}): CashuMovement {
  return {
    id: 'local-1',
    type: 'cashu_send',
    mint: MINT,
    amountSats: 21,
    status: 'pending',
    createdAt: 1_700_000_000,
    ...overrides,
  };
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  const event: NostrEvent = {
    id: 'e'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1_700_000_000,
    kind: 7376,
    tags: [],
    content: '',
    sig: '',
  };

  return {
    direction: 'out',
    amount: 21,
    unit: 'sat',
    destroyed: [],
    redeemed: [],
    isBackup: false,
    createdAt: event.created_at,
    event,
    ...overrides,
  };
}

describe('cashuTransactions', () => {
  it('drops a relay entry the local log already describes', () => {
    const rows = cashuTransactions([movement()], [entry()]);

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('cashu_send');
  });

  it('keeps a relay entry with no local counterpart', () => {
    const rows = cashuTransactions([], [entry()]);

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('unknown');
  });

  it('never counts a backfilled token entry as a movement', () => {
    /**
     * The send it belongs to was recorded when it happened. Counting the
     * backfill as well would show the same sats leaving twice — on a device
     * with no local log, where there is nothing to dedupe against.
     */
    const rows = cashuTransactions([], [entry({ isBackup: true })]);

    expect(rows).toEqual([]);
  });

  it('still counts the real send alongside its backfill', () => {
    const rows = cashuTransactions(
      [],
      [entry({ isBackup: true }), entry({ isBackup: false })]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(21);
  });
});
