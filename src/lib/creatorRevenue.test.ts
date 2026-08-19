import { describe, it, expect } from 'vitest';

import {
  describeRevenueSource,
  isRevenue,
  isZapPayment,
  reconcile,
  revenueSourceId,
  summarizeRevenue,
} from './creatorRevenue';
import type { LnbitsPayment } from './lnbits';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const DAY = 86_400_000;

/** A settled incoming payment, in the shape LNbits reports one. */
function payment(over: Partial<LnbitsPayment> = {}): LnbitsPayment {
  return {
    checking_id: 'c',
    payment_hash: 'h',
    wallet_id: 'w',
    // Millisatoshis, positive for incoming
    amount: 1_000_000,
    fee: 0,
    bolt11: 'lnbc',
    status: 'success',
    time: new Date(NOW - DAY).toISOString(),
    ...over,
  };
}

describe('isRevenue', () => {
  it('counts settled money in', () => {
    expect(isRevenue(payment())).toBe(true);
  });

  it('refuses money out', () => {
    // Outgoing is negative in LNbits; counting it would net spending against
    // earnings and call the result revenue
    expect(isRevenue(payment({ amount: -1_000_000 }))).toBe(false);
  });

  it('refuses anything not settled', () => {
    expect(isRevenue(payment({ status: 'pending' }))).toBe(false);
    expect(isRevenue(payment({ status: 'failed' }))).toBe(false);
  });
});

describe('revenueSourceId', () => {
  it('reads the extension that raised the invoice', () => {
    expect(revenueSourceId(payment({ tag: 'nostrnip5' }))).toBe('nostrnip5');
  });

  it('falls back to the extension field', () => {
    expect(revenueSourceId(payment({ extension: 'tipjar' }))).toBe('tipjar');
  });

  it('calls an unclaimed payment a direct invoice', () => {
    expect(revenueSourceId(payment())).toBe('direct');
  });

  it('normalises case and spacing', () => {
    expect(revenueSourceId(payment({ tag: ' LNURLp ' }))).toBe('lnurlp');
  });
});

describe('describeRevenueSource', () => {
  it('says what the money was for', () => {
    expect(describeRevenueSource('nostrnip5')).toBe('Names');
    expect(describeRevenueSource('direct')).toBe('Direct invoices');
  });

  it('keeps a tag it does not know rather than hiding it', () => {
    /*
     * A deployment that installs something new should see it appear in the
     * breakdown. Bucketing the unknown into "other" makes new revenue
     * invisible on the page whose job is to find it.
     */
    expect(describeRevenueSource('auction_house')).toBe('auction_house');
  });
});

describe('isZapPayment', () => {
  it('reads the zap request LNbits stored on the payment', () => {
    expect(isZapPayment(payment({ extra: { nostr: '{"kind":9734}' } }))).toBe(
      true
    );
  });

  it('treats no evidence as not a zap', () => {
    /*
     * The safe direction. Absence of the field means an older LNbits or an
     * extension that does not forward it — reading that as "zap" would
     * overstate the overlap and understate what the relays are missing, which
     * is the number this page exists to surface.
     */
    expect(isZapPayment(payment())).toBe(false);
    expect(isZapPayment(payment({ extra: {} }))).toBe(false);
    expect(isZapPayment(payment({ extra: { nostr: '' } }))).toBe(false);
  });
});

describe('summarizeRevenue', () => {
  it('totals settled money inside the window', () => {
    const summary = summarizeRevenue(
      [payment({ amount: 1_000_000 }), payment({ amount: 2_000_000 })],
      30,
      NOW
    );

    expect(summary.sats).toBe(3_000);
    expect(summary.count).toBe(2);
  });

  it('leaves out what falls outside the window', () => {
    const summary = summarizeRevenue(
      [
        payment({ amount: 1_000_000 }),
        payment({
          amount: 9_000_000,
          time: new Date(NOW - 40 * DAY).toISOString(),
        }),
      ],
      30,
      NOW
    );

    expect(summary.sats).toBe(1_000);
  });

  it('splits by what the money was for, biggest first', () => {
    const summary = summarizeRevenue(
      [
        payment({ amount: 1_000_000, tag: 'tipjar' }),
        payment({ amount: 5_000_000, tag: 'nostrnip5' }),
        payment({ amount: 2_000_000, tag: 'tipjar' }),
      ],
      30,
      NOW
    );

    expect(summary.bySource.map((row) => [row.label, row.sats])).toEqual([
      ['Names', 5_000],
      ['Tips', 3_000],
    ]);
    expect(summary.bySource[1].count).toBe(2);
  });

  it('names the overlap with the relay figures', () => {
    /**
     * The number that keeps the two halves from being added. A zap that
     * settled here is counted by the relays too, and a page showing both
     * totals without saying so invites somebody to sum them.
     */
    const summary = summarizeRevenue(
      [
        payment({ amount: 4_000_000, extra: { nostr: '{"kind":9734}' } }),
        payment({ amount: 1_000_000, tag: 'nostrnip5' }),
      ],
      30,
      NOW
    );

    expect(summary.zapSats).toBe(4_000);
    expect(summary.zapCount).toBe(1);
    expect(summary.otherSats).toBe(1_000);
  });

  it('compares against the window before it', () => {
    const summary = summarizeRevenue(
      [
        payment({ amount: 2_000_000 }),
        payment({
          amount: 1_000_000,
          time: new Date(NOW - 40 * DAY).toISOString(),
        }),
      ],
      30,
      NOW
    );

    expect(summary.change).toBe(100);
  });

  it('declines to compare against nothing', () => {
    // Not a 100% rise from zero: there is nothing to compare against, which is
    // a different statement and the one worth making
    expect(summarizeRevenue([payment()], 30, NOW).change).toBeNull();
  });

  it('drops a payment it cannot place in time', () => {
    /*
     * A timestamp that cannot be read leaves no way to know which window a
     * payment belongs to, and defaulting puts it in the one being looked at.
     */
    expect(summarizeRevenue([payment({ time: undefined })], 30, NOW).sats).toBe(
      0
    );
  });

  it('ignores a payment dated in the future', () => {
    expect(
      summarizeRevenue(
        [payment({ time: new Date(NOW + DAY).toISOString() })],
        30,
        NOW
      ).sats
    ).toBe(0);
  });

  it('answers safely for a wallet with no payments', () => {
    expect(summarizeRevenue([], 30, NOW)).toMatchObject({
      sats: 0,
      count: 0,
      bySource: [],
      change: null,
    });
  });
});

describe('reconcile', () => {
  it('separates money the relays never saw', () => {
    const balance = reconcile({ sats: 5_000, zapSats: 1_000 }, 1_000);
    expect(balance.walletOnlySats).toBe(4_000);
    expect(balance.relayOnlySats).toBe(0);
  });

  it('separates zaps that landed somewhere else', () => {
    // Counted from receipts, never arrived here: paid to a lightning address
    // this wallet does not hold
    const balance = reconcile({ sats: 1_000, zapSats: 1_000 }, 3_000);
    expect(balance.relayOnlySats).toBe(2_000);
    expect(balance.walletOnlySats).toBe(0);
  });

  it('never reports a negative difference', () => {
    // More settled here than the relays counted is normal, not a deficit
    expect(reconcile({ sats: 9_000, zapSats: 9_000 }, 1_000).relayOnlySats).toBe(
      0
    );
  });

  it('calls two sides that match agreed', () => {
    expect(reconcile({ sats: 1_000, zapSats: 1_000 }, 1_000).agrees).toBe(true);
    expect(reconcile({ sats: 0, zapSats: 0 }, 0).agrees).toBe(true);
  });

  it('does not call a real gap agreement', () => {
    expect(reconcile({ sats: 5_000, zapSats: 1_000 }, 4_000).agrees).toBe(false);
  });
});
