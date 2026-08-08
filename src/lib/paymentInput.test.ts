import { describe, it, expect } from 'vitest';
import { parsePaymentTarget, readInvoiceSats } from './paymentInput';

describe('parsePaymentTarget', () => {
  it('recognises a mainnet invoice', () => {
    expect(parsePaymentTarget('lnbc1u1p3xyz')).toEqual({
      kind: 'invoice',
      value: 'lnbc1u1p3xyz',
    });
  });

  it('recognises test network invoices', () => {
    expect(parsePaymentTarget('lntb500n1pabc').kind).toBe('invoice');
    expect(parsePaymentTarget('lnbcrt10m1pabc').kind).toBe('invoice');
  });

  it('strips a lightning: URI from a scanned code', () => {
    expect(parsePaymentTarget('lightning:lnbc1u1p3xyz')).toEqual({
      kind: 'invoice',
      value: 'lnbc1u1p3xyz',
    });
  });

  it('pulls the invoice out of a unified bitcoin URI', () => {
    expect(
      parsePaymentTarget('bitcoin:bc1qexample?lightning=lnbc1u1p3xyz')
    ).toEqual({ kind: 'invoice', value: 'lnbc1u1p3xyz' });
  });

  it('lower-cases an invoice pasted in upper case', () => {
    expect(parsePaymentTarget('LNBC1U1P3XYZ')).toEqual({
      kind: 'invoice',
      value: 'lnbc1u1p3xyz',
    });
  });

  it('recognises a lightning address', () => {
    expect(parsePaymentTarget(' Satoshi@NostrFeed.com ')).toEqual({
      kind: 'address',
      value: 'satoshi@nostrfeed.com',
    });
  });

  it('recognises an LNURL', () => {
    expect(parsePaymentTarget('LNURL1DP68GURN8GHJ7').kind).toBe('lnurl');
  });

  it('reports an empty box as empty rather than invalid', () => {
    expect(parsePaymentTarget('   ')).toEqual({ kind: 'empty' });
  });

  it('rejects an npub, which is not payable', () => {
    expect(parsePaymentTarget('npub1abcdef').kind).toBe('unknown');
  });

  it('rejects a bare @ that is not an address', () => {
    expect(parsePaymentTarget('me@localhost').kind).toBe('unknown');
  });
});

describe('readInvoiceSats', () => {
  it('reads micro-bitcoin, the usual unit for small amounts', () => {
    // 1u BTC = 100 sats
    expect(readInvoiceSats('lnbc1u1pabc')).toBe(100);
  });

  it('reads nano-bitcoin', () => {
    // 250n BTC = 25 sats
    expect(readInvoiceSats('lnbc250n1pabc')).toBe(25);
  });

  it('reads milli-bitcoin', () => {
    // 1m BTC = 100,000 sats
    expect(readInvoiceSats('lnbc1m1pabc')).toBe(100_000);
  });

  it('reads pico-bitcoin, rounding a sub-satoshi amount up', () => {
    // 1p BTC is a tenth of a sat, and showing that as free would be a lie
    expect(readInvoiceSats('lnbc1p1pabc')).toBe(1);
  });

  it('reads a whole-bitcoin amount with no unit suffix', () => {
    expect(readInvoiceSats('lnbc21pabc')).toBe(2 * 100_000_000);
  });

  it('returns null for an amountless invoice', () => {
    // Valid, and means "any amount" — the caller has to ask for one
    expect(readInvoiceSats('lnbc1pabc')).toBeNull();
  });

  it('returns null for something that is not an invoice', () => {
    expect(readInvoiceSats('satoshi@nostrfeed.com')).toBeNull();
  });

  it('reads a testnet invoice the same way', () => {
    expect(readInvoiceSats('lntb1u1pabc')).toBe(100);
  });
});
