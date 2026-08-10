import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import {
  decryptToNsec,
  encryptKey,
  isNcryptsec,
  isNsec,
  isSecretKeyInput,
} from './keyTransfer';

const secretKey = generateSecretKey();
const nsec = nip19.nsecEncode(secretKey);
const npub = nip19.npubEncode(getPublicKey(secretKey));

describe('key recognition', () => {
  it('accepts a real nsec', () => {
    expect(isNsec(nsec)).toBe(true);
    expect(isSecretKeyInput(nsec)).toBe(true);
  });

  it('tolerates the whitespace a paste brings with it', () => {
    expect(isNsec(`  ${nsec}\n`)).toBe(true);
  });

  it('rejects an npub, which is the easy thing to paste by mistake', () => {
    expect(isNsec(npub)).toBe(false);
    expect(isSecretKeyInput(npub)).toBe(false);
  });

  it('rejects near-misses rather than passing them to the decoder', () => {
    expect(isNsec('nsec1')).toBe(false);
    expect(isNsec('')).toBe(false);
    expect(isNcryptsec('ncryptsec')).toBe(false);
  });
});

describe('encryptKey / decryptToNsec', () => {
  it('round-trips a key through a passphrase', () => {
    const encrypted = encryptKey(nsec, 'correct horse battery');

    expect(isNcryptsec(encrypted)).toBe(true);
    expect(isSecretKeyInput(encrypted)).toBe(true);
    expect(decryptToNsec(encrypted, 'correct horse battery')).toBe(nsec);
  });

  it('produces a different payload each time from the same key', () => {
    // Same key, same passphrase, different salt — otherwise two exports would
    // be comparable, and a matching pair tells an observer they are the same
    const a = encryptKey(nsec, 'correct horse battery');
    const b = encryptKey(nsec, 'correct horse battery');

    expect(a).not.toBe(b);
    expect(decryptToNsec(b, 'correct horse battery')).toBe(nsec);
  });

  it('refuses a wrong passphrase in words a person can act on', () => {
    const encrypted = encryptKey(nsec, 'correct horse battery');

    expect(() => decryptToNsec(encrypted, 'wrong passphrase')).toThrow(
      /passphrase does not open this key/i
    );
  });

  it('refuses a passphrase too short to be worth anything', () => {
    expect(() => encryptKey(nsec, 'short')).toThrow(/at least 8/i);
  });

  it('refuses anything that is not an nsec', () => {
    expect(() => encryptKey('npub1whatever', 'correct horse battery')).toThrow(
      /not an nsec/i
    );
  });
}, 30_000);
