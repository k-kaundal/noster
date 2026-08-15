import { describe, it, expect } from 'vitest';
import type { LnbitsPayment } from './lnbits';
import {
  describeIncoming,
  incomingSince,
  newestArrival,
  withoutZapped,
} from './walletNotify';

const payment = (overrides: Partial<LnbitsPayment> = {}): LnbitsPayment => ({
  checking_id: 'check-1',
  payment_hash: 'hash-1',
  wallet_id: 'wallet-1',
  amount: 21_000,
  fee: 0,
  bolt11: 'lnbc210n1p',
  status: 'success',
  time: 1_700_000_000,
  ...overrides,
});

describe('incomingSince', () => {
  it('reports a settled incoming payment', () => {
    const [arrival] = incomingSince([payment()], 0);

    expect(arrival.amountSats).toBe(21);
    expect(arrival.checkingId).toBe('check-1');
  });

  it('ignores outgoing payments, which LNbits signs negative', () => {
    expect(incomingSince([payment({ amount: -21_000 })], 0)).toEqual([]);
  });

  it('ignores a payment that has not settled', () => {
    // Announcing a pending arrival announces something that can still fail
    expect(incomingSince([payment({ status: 'pending' })], 0)).toEqual([]);
  });

  it('accepts the older `paid` flag as settlement', () => {
    const older = { ...payment({ status: 'unknown' }), paid: true };

    expect(incomingSince([older as LnbitsPayment], 0)).toHaveLength(1);
  });

  it('ignores anything at or before the marker', () => {
    expect(incomingSince([payment()], 1_700_000_000_000)).toEqual([]);
  });

  it('drops a row whose timestamp cannot be read', () => {
    // paymentTimeMs answers 0, which is older than every marker — treating it
    // as new would announce it on every poll forever
    expect(incomingSince([payment({ time: 'not a date' })], 0)).toEqual([]);
  });

  it('reads ISO timestamps as well as unix seconds', () => {
    const [arrival] = incomingSince(
      [payment({ time: '2024-05-01T10:00:00Z' })],
      0
    );

    expect(arrival.timeMs).toBe(Date.parse('2024-05-01T10:00:00Z'));
  });

  it('returns newest first', () => {
    const arrivals = incomingSince(
      [
        payment({ checking_id: 'old', time: 1_700_000_000 }),
        payment({ checking_id: 'new', time: 1_700_000_900 }),
      ],
      0
    );

    expect(arrivals.map((entry) => entry.checkingId)).toEqual(['new', 'old']);
  });
});

describe('withoutZapped', () => {
  const arrivals = incomingSince([payment()], 0);

  it('drops an arrival a zap receipt already spoke for', () => {
    // Both hold the same invoice string, so this is an exact match rather than
    // a guess from amounts and timestamps
    expect(withoutZapped(arrivals, ['lnbc210n1p'])).toEqual([]);
  });

  it('matches regardless of case or padding', () => {
    expect(withoutZapped(arrivals, [' LNBC210N1P '])).toEqual([]);
  });

  it('keeps an arrival no receipt mentions', () => {
    // The case this whole file exists for: a plain lightning-address payment,
    // which is not a zap and writes no receipt at all
    expect(withoutZapped(arrivals, ['lnbc-something-else'])).toHaveLength(1);
  });

  it('keeps everything when nothing was zapped', () => {
    expect(withoutZapped(arrivals, [])).toHaveLength(1);
  });
});

describe('newestArrival', () => {
  it('answers the fallback when the ledger holds nothing incoming', () => {
    expect(newestArrival([payment({ amount: -1000 })], 42)).toBe(42);
  });

  it('answers the newest settled arrival', () => {
    expect(
      newestArrival(
        [payment({ time: 1_700_000_000 }), payment({ time: 1_700_000_900 })],
        0
      )
    ).toBe(1_700_000_900_000);
  });

  it('never moves backwards from the fallback', () => {
    expect(newestArrival([payment()], 9_999_999_999_999)).toBe(
      9_999_999_999_999
    );
  });
});

describe('describeIncoming', () => {
  const [arrival] = incomingSince([payment()], 0);

  it('leads with the amount', () => {
    expect(describeIncoming(arrival).title).toContain('21 sats');
  });

  it('shows what the payer wrote', () => {
    expect(
      describeIncoming({ ...arrival, memo: 'thanks for the article' }).body
    ).toBe('thanks for the article');
  });

  it('ignores the description LNbits writes into its own rows', () => {
    // Repeating our own pay link's description back says nothing the title did
    // not already say
    expect(describeIncoming({ ...arrival, memo: 'NostrFeed' }).body).toBe(
      'Landed in your NostrFeed wallet.'
    );
  });
});
