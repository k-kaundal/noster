import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INVOICE_TTL_MS,
  describePayment,
  filterPayments,
  groupByDay,
  isOpenRequest,
  isSettled,
  minutesLeft,
  readPayment,
  totals,
  type WalletPayment,
} from './payments';
import type { LnbitsPayment } from './lnbits';

const NOW = Date.parse('2026-06-15T12:00:00Z');
const MINUTE = 60_000;

function row(overrides: Partial<LnbitsPayment> = {}): LnbitsPayment {
  return {
    checking_id: 'check-1',
    payment_hash: 'hash-1',
    wallet_id: 'wallet-1',
    amount: 5_000_000,
    fee: 0,
    bolt11: 'lnbc50u1p...',
    status: 'success',
    time: new Date(NOW - 5 * MINUTE).toISOString(),
    ...overrides,
  };
}

describe('readPayment', () => {
  it('reads an arrival', () => {
    const payment = readPayment(row(), NOW);

    expect(payment.direction).toBe('incoming');
    expect(payment.state).toBe('received');
    expect(payment.sats).toBe(5_000);
  });

  it('reads a spend from the negative amount', () => {
    const payment = readPayment(
      row({ amount: -2_000_000, fee: -1_000 }),
      NOW
    );

    expect(payment.direction).toBe('outgoing');
    expect(payment.state).toBe('sent');
    // Always positive: the direction carries the sign, so a UI that renders
    // "−{sats}" cannot end up printing a double negative
    expect(payment.sats).toBe(2_000);
    expect(payment.feeSats).toBe(1);
  });

  it('calls an unpaid incoming invoice a request, not money', () => {
    /**
     * The distinction this whole module exists for. An unpaid invoice was
     * rendered as an arrival at reduced opacity, which reads as "received" to
     * anybody not looking for the difference.
     */
    const payment = readPayment(row({ status: 'pending' }), NOW);

    expect(payment.state).toBe('request');
    expect(isSettled(payment)).toBe(false);
    expect(isOpenRequest(payment)).toBe(true);
  });

  it('calls one that ran out of time expired', () => {
    const payment = readPayment(
      row({
        status: 'pending',
        time: new Date(NOW - 3 * 60 * MINUTE).toISOString(),
      }),
      NOW
    );

    expect(payment.state).toBe('expired');
    expect(isOpenRequest(payment)).toBe(false);
  });

  it('uses the expiry the server gave over the default', () => {
    const payment = readPayment(
      {
        ...row({ status: 'pending' }),
        expiry: new Date(NOW + 10 * MINUTE).toISOString(),
      },
      NOW
    );

    expect(payment.state).toBe('request');
    expect(payment.expiresAt).toBe(NOW + 10 * MINUTE);
  });

  it('falls back to the standard hour when there is no expiry', () => {
    const created = NOW - 5 * MINUTE;
    const payment = readPayment(
      row({ status: 'pending', time: new Date(created).toISOString() }),
      NOW
    );

    expect(payment.expiresAt).toBe(created + DEFAULT_INVOICE_TTL_MS);
  });

  it('never expires an outgoing payment', () => {
    // Its invoice's clock belongs to whoever issued it; on this side the
    // payment is either made or not
    const payment = readPayment(
      row({ amount: -1_000_000, status: 'pending' }),
      NOW
    );

    expect(payment.state).toBe('sending');
    expect(payment.expiresAt).toBeNull();
  });

  it('reads the older boolean settlement flag', () => {
    expect(
      readPayment({ ...row({ status: '' }), pending: true }, NOW).state
    ).toBe('request');
    expect(
      readPayment({ ...row({ status: '' }), pending: false }, NOW).state
    ).toBe('received');
  });

  it('treats an unrecognised status as settled', () => {
    /**
     * These rows come from a list the balance already reflects, so reading an
     * unknown status as pending would invent an open request nobody can act
     * on and that never resolves.
     */
    expect(readPayment(row({ status: 'weird' }), NOW).state).toBe('received');
  });

  it('reads the extension that made it', () => {
    expect(readPayment(row({ extra: { tag: 'lnurlp' } }), NOW).tag).toBe(
      'lnurlp'
    );
    expect(readPayment(row(), NOW).tag).toBeUndefined();
  });
});

describe('minutesLeft', () => {
  it('counts down an open request', () => {
    const payment = readPayment(
      {
        ...row({ status: 'pending' }),
        expiry: new Date(NOW + 5.5 * MINUTE).toISOString(),
      },
      NOW
    );

    expect(minutesLeft(payment, NOW)).toBe(6);
  });

  it('says nothing about anything else', () => {
    expect(minutesLeft(readPayment(row(), NOW), NOW)).toBeNull();
  });
});

describe('totals', () => {
  const payments = [
    readPayment(row({ payment_hash: 'a', amount: 3_000_000 }), NOW),
    readPayment(
      row({ payment_hash: 'b', amount: -1_000_000, fee: -2_000 }),
      NOW
    ),
    readPayment(row({ payment_hash: 'c', status: 'pending' }), NOW),
  ];

  it('adds up what actually moved', () => {
    expect(totals(payments)).toEqual({ inSats: 3_000, outSats: 1_002, count: 2 });
  });

  it('leaves requests out of the count', () => {
    // Counting them would make "3 payments" disagree with the balance
    expect(totals(payments).count).toBe(2);
  });

  it('honours a window', () => {
    const old = readPayment(
      row({
        payment_hash: 'old',
        amount: 9_000_000,
        time: new Date(NOW - 40 * 86_400_000).toISOString(),
      }),
      NOW
    );

    expect(totals([...payments, old], NOW - 30 * 86_400_000).inSats).toBe(3_000);
  });
});

describe('filterPayments', () => {
  const payments = [
    readPayment(row({ payment_hash: 'in', memo: 'coffee' }), NOW),
    readPayment(row({ payment_hash: 'out', amount: -500_000 }), NOW),
    readPayment(row({ payment_hash: 'req', status: 'pending' }), NOW),
    readPayment(
      row({
        payment_hash: 'dead',
        status: 'pending',
        time: new Date(NOW - 3 * 60 * MINUTE).toISOString(),
      }),
      NOW
    ),
  ];

  it('separates arrivals from requests', () => {
    expect(filterPayments(payments, 'in').map((p) => p.id)).toEqual(['in']);
  });

  it('keeps expired requests with the open ones', () => {
    // This is the tab somebody opens to find out what became of an invoice
    // they handed to somebody else
    expect(filterPayments(payments, 'requests').map((p) => p.id)).toEqual([
      'req',
      'dead',
    ]);
  });

  it('searches the memo and the hash', () => {
    expect(filterPayments(payments, 'all', 'coffee').map((p) => p.id)).toEqual([
      'in',
    ]);
    expect(filterPayments(payments, 'all', 'DEAD').map((p) => p.id)).toEqual([
      'dead',
    ]);
  });

  it('matches an amount exactly rather than by substring', () => {
    // 500 must not drag in every 5,000 and 1,500 in the list, which is the
    // opposite of what somebody hunting for one payment wants
    expect(filterPayments(payments, 'all', '500').map((p) => p.id)).toEqual([
      'out',
    ]);
    expect(filterPayments(payments, 'all', '5,000').map((p) => p.id)).toEqual([
      'in',
      'req',
      'dead',
    ]);
  });
});

describe('groupByDay', () => {
  it('names today and yesterday', () => {
    const days = groupByDay(
      [
        readPayment(row({ payment_hash: 'now' }), NOW),
        readPayment(
          row({
            payment_hash: 'then',
            time: new Date(NOW - 86_400_000).toISOString(),
          }),
          NOW
        ),
      ],
      NOW
    );

    expect(days.map((day) => day.label)).toEqual(['Today', 'Yesterday']);
  });

  it('puts the newest day first', () => {
    const days = groupByDay(
      [
        readPayment(
          row({
            payment_hash: 'older',
            time: new Date(NOW - 5 * 86_400_000).toISOString(),
          }),
          NOW
        ),
        readPayment(row({ payment_hash: 'newer' }), NOW),
      ],
      NOW
    );

    expect(days[0].payments[0].id).toBe('newer');
  });

  it('keeps an undated row rather than dropping it', () => {
    const days = groupByDay([readPayment(row({ time: undefined }), NOW)], NOW);

    expect(days[0].label).toBe('Undated');
  });
});

describe('describePayment', () => {
  it('prefers what the person wrote', () => {
    expect(describePayment(readPayment(row({ memo: 'rent' }), NOW)).title).toBe(
      'rent'
    );
  });

  it('says what happened when there is no memo', () => {
    const request = readPayment(row({ status: 'pending' }), NOW);

    expect(describePayment(request)).toEqual({
      title: 'Payment request',
      detail: 'Waiting to be paid',
    });
  });

  it('distinguishes an expired request from a paid one', () => {
    const expired: WalletPayment = {
      ...readPayment(row({ status: 'pending' }), NOW),
      state: 'expired',
    };

    expect(describePayment(expired).detail).toBe('Expired unpaid');
  });
});
