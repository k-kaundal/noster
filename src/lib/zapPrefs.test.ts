import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ZAP_PREFS,
  DEFAULT_ZAP_SATS,
  MAX_ONE_TAP_SATS,
  ZAP_PREFS_VERSION,
  describeBlocker,
  readZapPrefs,
  zapReadiness,
} from './zapPrefs';

/** A stored record that counts as somebody's own choice. */
const chosen = (prefs: Record<string, unknown>) => ({
  version: ZAP_PREFS_VERSION,
  ...prefs,
});

describe('readZapPrefs', () => {
  it('defaults to 50 sats, no message, and one-tap on', () => {
    expect(readZapPrefs(undefined)).toEqual(DEFAULT_ZAP_PREFS);
    expect(DEFAULT_ZAP_SATS).toBe(50);
    expect(DEFAULT_ZAP_PREFS.oneTap).toBe(true);
  });

  it('keeps what somebody chose', () => {
    expect(
      readZapPrefs(chosen({ amount: 500, message: 'nice', oneTap: false }))
    ).toEqual({ amount: 500, message: 'nice', oneTap: false });
  });

  it('gives current defaults to a record written before them', () => {
    /**
     * The whole point of the version stamp. An unversioned record was written
     * when the defaults were 21 sats and one-tap off, and cannot say whether
     * those were chosen or handed over — so it is read as no choice at all,
     * and everybody moves to the current defaults.
     */
    expect(readZapPrefs({ amount: 21, message: '', oneTap: false })).toEqual(
      DEFAULT_ZAP_PREFS
    );
  });

  it('repairs an amount nobody could pay', () => {
    // Storage is edited by hand and arrives from other devices
    expect(readZapPrefs(chosen({ amount: 0 })).amount).toBe(DEFAULT_ZAP_SATS);
    expect(readZapPrefs(chosen({ amount: -5 })).amount).toBe(DEFAULT_ZAP_SATS);
    expect(readZapPrefs(chosen({ amount: 'lots' })).amount).toBe(
      DEFAULT_ZAP_SATS
    );
  });

  it('floors a fractional amount rather than refusing it', () => {
    expect(readZapPrefs(chosen({ amount: 21.9 })).amount).toBe(21);
  });

  it('takes only an explicit false as one-tap off', () => {
    expect(readZapPrefs(chosen({ oneTap: false })).oneTap).toBe(false);
    expect(readZapPrefs(chosen({ oneTap: 'no' })).oneTap).toBe(true);
  });
});

describe('zapReadiness', () => {
  const ready = {
    signedIn: true,
    isSelf: false,
    recipientHasAddress: true,
    hasWallet: true,
    balanceSats: 1_000,
    amount: 21,
  };

  it('allows a one-tap send when everything is in place', () => {
    expect(zapReadiness(ready)).toEqual({ canOneTap: true, blocker: null });
  });

  it('blocks when the recipient cannot be paid at all', () => {
    expect(
      zapReadiness({ ...ready, recipientHasAddress: false }).blocker
    ).toBe('no-address');
  });

  it('blocks somebody zapping themselves', () => {
    expect(zapReadiness({ ...ready, isSelf: true }).blocker).toBe('self');
  });

  it('blocks a one-tap send with no wallet, without blocking zapping', () => {
    /**
     * The distinction that matters. Having no wallet stops the instant send
     * and not the dialog, which can still produce an invoice to pay from a
     * phone — so this must fall back rather than disable the control.
     */
    expect(zapReadiness({ ...ready, hasWallet: false }).blocker).toBe(
      'no-wallet'
    );
  });

  it('blocks a send larger than the balance', () => {
    expect(
      zapReadiness({ ...ready, balanceSats: 10, amount: 21 }).blocker
    ).toBe('insufficient');
  });

  it('allows a send exactly equal to the balance', () => {
    expect(
      zapReadiness({ ...ready, balanceSats: 21, amount: 21 }).canOneTap
    ).toBe(true);
  });

  it('sends a large amount through the dialog rather than one tap', () => {
    /**
     * The ceiling is on the mode, not on zapping. A configured amount above
     * it is not refused — it falls back to the flow that asks first, which is
     * what somebody sending that much would want anyway.
     */
    expect(
      zapReadiness({
        ...ready,
        amount: MAX_ONE_TAP_SATS + 1,
        balanceSats: 10_000_000,
      }).blocker
    ).toBe('over-limit');

    expect(
      zapReadiness({ ...ready, amount: MAX_ONE_TAP_SATS, balanceSats: 10_000_000 })
        .canOneTap
    ).toBe(true);
  });

  it('reports the ceiling before the wallet', () => {
    // The amount is wrong on every device; the missing wallet is only wrong
    // on this one
    expect(
      zapReadiness({ ...ready, amount: 999_999, hasWallet: false }).blocker
    ).toBe('over-limit');
  });

  it('reports the wallet before the balance', () => {
    // "Connect a wallet" is actionable; "not enough sats" in a wallet that
    // does not exist is not
    expect(
      zapReadiness({ ...ready, hasWallet: false, balanceSats: 0 }).blocker
    ).toBe('no-wallet');
  });
});

describe('describeBlocker', () => {
  it('says what can be done about it', () => {
    expect(describeBlocker('no-wallet', 21)).toContain('still zap by invoice');
    expect(describeBlocker('insufficient', 500)).toContain('500');
  });

  it('says nothing when nothing is wrong', () => {
    expect(describeBlocker(null, 21)).toBeNull();
  });
});
