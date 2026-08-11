import { describe, it, expect } from 'vitest';
import {
  LAWALLET_MAX_USERNAME,
  LaWalletError,
  invoiceAmountSats,
  requiresPayment,
  describeMode,
  isLive,
  laWalletAddress,
  suggestLaWalletName,
  validateLaWalletName,
  type WalletAddress,
} from './lawallet';

function address(overrides: Partial<WalletAddress> = {}): WalletAddress {
  return { username: 'alice', mode: 'IDLE', ...overrides };
}

describe('validateLaWalletName', () => {
  it('accepts lowercase letters and numbers', () => {
    expect(validateLaWalletName('alice99')).toBeNull();
  });

  it('rejects the punctuation our own addresses allow', () => {
    // Our LNbits addresses take dots, dashes and underscores; this service
    // does not, and finding that out from a 400 is a poor way to learn it
    for (const name of ['first.last', 'first-last', 'first_last']) {
      expect(validateLaWalletName(name)).toBe('invalid-characters');
    }
  });

  it('rejects capitals and spaces', () => {
    expect(validateLaWalletName('Alice')).toBe('invalid-characters');
    expect(validateLaWalletName('al ice')).toBe('invalid-characters');
  });

  it('enforces the length limit', () => {
    expect(validateLaWalletName('a'.repeat(LAWALLET_MAX_USERNAME))).toBeNull();
    expect(validateLaWalletName('a'.repeat(LAWALLET_MAX_USERNAME + 1))).toBe(
      'too-long'
    );
  });

  it('rejects nothing at all', () => {
    expect(validateLaWalletName('')).toBe('empty');
  });
});

describe('suggestLaWalletName', () => {
  it('folds a name down to what the service accepts', () => {
    expect(suggestLaWalletName('First.Last')).toBe('firstlast');
    expect(suggestLaWalletName('José Ruiz')).toBe('joseruiz');
  });

  it('truncates rather than producing something that will be refused', () => {
    expect(suggestLaWalletName('a'.repeat(40))).toHaveLength(
      LAWALLET_MAX_USERNAME
    );
  });

  it('can end up with nothing, which the caller has to handle', () => {
    expect(suggestLaWalletName('日本語')).toBe('');
  });
});

describe('laWalletAddress', () => {
  it('builds the address from the configured domain', () => {
    expect(laWalletAddress('alice')).toMatch(/^alice@/);
  });
});

describe('describeMode', () => {
  it('names the destination of an alias', () => {
    expect(
      describeMode(address({ mode: 'ALIAS', redirect: 'me@getalby.com' }))
    ).toContain('me@getalby.com');
  });

  it('mentions the zap receipts a proxy alias adds', () => {
    // The whole reason to choose the proxy over a plain alias
    expect(
      describeMode(address({ mode: 'PROXY_ALIAS', redirect: 'me@x.com' }))
    ).toMatch(/zap receipts/i);
  });

  it('says a connected wallet pays it', () => {
    expect(describeMode(address({ mode: 'CUSTOM_NWC' }))).toMatch(/connected/i);
  });

  it('warns that an unpointed address refuses payments', () => {
    // IDLE resolves and then declines, which looks like a working address
    // right up until someone tries to pay it
    expect(describeMode(address())).toMatch(/refuse/i);
  });
});

describe('isLive', () => {
  it('needs a destination for an alias', () => {
    expect(isLive(address({ mode: 'ALIAS' }))).toBe(false);
    expect(isLive(address({ mode: 'ALIAS', redirect: 'me@x.com' }))).toBe(true);
  });

  it('needs a wallet for a custom NWC address', () => {
    expect(isLive(address({ mode: 'CUSTOM_NWC' }))).toBe(false);
    expect(isLive(address({ mode: 'CUSTOM_NWC', remoteWalletId: 'w1' }))).toBe(
      true
    );
  });

  it('is never live while idle', () => {
    expect(isLive(address({ mode: 'IDLE' }))).toBe(false);
  });
});

describe('requiresPayment', () => {
  const fail = (status: number, message = 'nope', code?: string) =>
    new LaWalletError(message, status, code);

  it('reads 402 as a price', () => {
    expect(requiresPayment(fail(402))).toBe(true);
  });

  it('reads an explicit code', () => {
    expect(requiresPayment(fail(400, 'nope', 'PAYMENT_REQUIRED'))).toBe(true);
  });

  it('reads a refusal that says to pay', () => {
    expect(requiresPayment(fail(400, 'An invoice must be paid first'))).toBe(true);
    expect(requiresPayment(fail(403, 'Purchase required for this name'))).toBe(true);
  });

  it('does not read a taken name as a price', () => {
    // Sending someone to a payment screen because a name was taken is worse
    // than the error it replaced — they would pay for nothing
    expect(requiresPayment(fail(409, 'That name is already taken'))).toBe(false);
    expect(requiresPayment(fail(400, 'Invalid username'))).toBe(false);
  });

  it('does not read an auth or server failure as a price', () => {
    expect(requiresPayment(fail(401, 'Sign in again'))).toBe(false);
    expect(requiresPayment(fail(500, 'Unhandled server error'))).toBe(false);
  });

  it('ignores errors from somewhere else entirely', () => {
    expect(requiresPayment(new Error('payment failed'))).toBe(false);
    expect(requiresPayment(undefined)).toBe(false);
  });
});

describe('invoiceAmountSats', () => {
  it('reads the common multipliers', () => {
    // 100 sats is 1 microBTC; 1000 sats is 10u; 0.001 BTC is 1m
    expect(invoiceAmountSats('lnbc1u1p3xyz')).toBe(100);
    expect(invoiceAmountSats('lnbc10u1p3xyz')).toBe(1000);
    expect(invoiceAmountSats('lnbc1m1p3xyz')).toBe(100_000);
    expect(invoiceAmountSats('lnbc100n1p3xyz')).toBe(10);
  });

  it('reads a whole-bitcoin invoice, whose amount precedes the separator', () => {
    // `lnbc11p3...` is amount `1` then the separator `1`
    expect(invoiceAmountSats('lnbc11p3xyz')).toBe(100_000_000);
  });

  it('handles testnet and regtest prefixes', () => {
    expect(invoiceAmountSats('lntb1u1p3xyz')).toBe(100);
    expect(invoiceAmountSats('lnbcrt1u1p3xyz')).toBe(100);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(invoiceAmountSats('  LNBC1U1P3XYZ ')).toBe(100);
  });

  it('says nothing for an amountless invoice, rather than reading the separator', () => {
    // `lnbc1p3...` carries no amount — that `1` is the bech32 separator.
    // Reading it as a figure offers to pay one whole bitcoin
    expect(invoiceAmountSats('lnbc1p3xyz')).toBeNull();
    expect(invoiceAmountSats('lntb1p3xyz')).toBeNull();
    expect(invoiceAmountSats('not an invoice')).toBeNull();
    expect(invoiceAmountSats('')).toBeNull();
  });
});
