import { describe, it, expect } from 'vitest';
import {
  LAWALLET_MAX_USERNAME,
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
