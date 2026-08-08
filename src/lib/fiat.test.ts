import { describe, it, expect } from 'vitest';
import {
  isFiatProvider,
  readCheckoutUrl,
  subscriptionRequestId,
} from './fiat';

describe('isFiatProvider', () => {
  it('accepts the providers LNbits brokers', () => {
    expect(isFiatProvider('paypal')).toBe(true);
    expect(isFiatProvider('stripe')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isFiatProvider('bitcoin')).toBe(false);
    expect(isFiatProvider('')).toBe(false);
  });
});

describe('subscriptionRequestId', () => {
  const npub = `npub1${'a'.repeat(58)}`;

  it('names the plan and the buyer', () => {
    const id = subscriptionRequestId(npub, 'monthly');

    expect(id.startsWith('nostrfeed-monthly-')).toBe(true);
    expect(id).toContain(npub.slice(0, 32));
  });

  it('distinguishes the two plans for the same buyer', () => {
    expect(subscriptionRequestId(npub, 'monthly')).not.toBe(
      subscriptionRequestId(npub, 'lifetime')
    );
  });

  it('distinguishes two buyers on the same plan', () => {
    const other = `npub1${'b'.repeat(58)}`;

    expect(subscriptionRequestId(npub, 'monthly')).not.toBe(
      subscriptionRequestId(other, 'monthly')
    );
  });

  it('stays short enough for a provider reference field', () => {
    expect(subscriptionRequestId(npub, 'lifetime').length).toBeLessThanOrEqual(64);
  });
});

describe('readCheckoutUrl', () => {
  it('returns the URL the payer is sent to', () => {
    expect(
      readCheckoutUrl({ ok: true, checkout_session_url: 'https://paypal.com/x' })
    ).toBe('https://paypal.com/x');
  });

  it('raises the provider\'s own reason when it refused', () => {
    expect(() =>
      readCheckoutUrl({ ok: false, error_message: 'Plan not found' })
    ).toThrow('Plan not found');
  });

  it('does not treat a missing URL as success', () => {
    // `ok: true` with nothing to open would strand the payer on a blank page
    expect(() => readCheckoutUrl({ ok: true })).toThrow();
  });
});
