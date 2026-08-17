import { describe, it, expect, beforeEach } from 'vitest';
import {
  knownProviders,
  providerDomain,
  providerKeyFor,
  providerKeyForRecipients,
  rememberProvider,
  resetProviders,
} from './zapProviders';

const KEY = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

beforeEach(resetProviders);

describe('providerDomain', () => {
  it('reads the server out of a lightning address', () => {
    expect(providerDomain('alice@getzap.me')).toBe('getzap.me');
  });

  it('lowercases it, since a domain is case-insensitive', () => {
    // Otherwise one server is remembered twice and verified for neither
    expect(providerDomain('Alice@GetZap.ME')).toBe('getzap.me');
  });

  it('ignores surrounding space', () => {
    expect(providerDomain('  alice@getzap.me  ')).toBe('getzap.me');
  });

  it('refuses anything that is not an address', () => {
    expect(providerDomain('not-an-address')).toBeNull();
    expect(providerDomain('alice@')).toBeNull();
    expect(providerDomain('@getzap.me')).toBeNull();
    expect(providerDomain('alice@localhost')).toBeNull();
    expect(providerDomain('alice@a@b.com')).toBeNull();
    expect(providerDomain(undefined)).toBeNull();
  });
});

describe('rememberProvider', () => {
  it('learns the key a server signs with', () => {
    expect(rememberProvider('alice@getzap.me', KEY)).toBe(true);
    expect(providerKeyFor('alice@getzap.me')).toBe(KEY);
  });

  it('answers for every address on that server', () => {
    // One server signs for all of its names, which is what makes the table
    // worth keeping: zapping one person teaches us how to verify the rest
    rememberProvider('alice@getzap.me', KEY);

    expect(providerKeyFor('bob@getzap.me')).toBe(KEY);
  });

  it('refuses a key that is not a BIP-340 pubkey', () => {
    expect(rememberProvider('alice@getzap.me', 'nope')).toBe(false);
    expect(rememberProvider('alice@getzap.me', '')).toBe(false);
    expect(rememberProvider('alice@getzap.me', undefined)).toBe(false);
    expect(rememberProvider('alice@getzap.me', 'a'.repeat(63))).toBe(false);
    expect(providerKeyFor('alice@getzap.me')).toBeUndefined();
  });

  it('refuses to record against something that is not an address', () => {
    expect(rememberProvider('nonsense', KEY)).toBe(false);
    expect(knownProviders()).toEqual({});
  });

  it('stores the key in lower case, however it was served', () => {
    rememberProvider('alice@getzap.me', KEY.toUpperCase());
    expect(providerKeyFor('alice@getzap.me')).toBe(KEY);
  });

  it('says nothing changed when the same key arrives again', () => {
    rememberProvider('alice@getzap.me', KEY);
    expect(rememberProvider('alice@getzap.me', KEY)).toBe(false);
  });

  it('takes a new key when a server rotates it', () => {
    rememberProvider('alice@getzap.me', KEY);

    expect(rememberProvider('alice@getzap.me', OTHER)).toBe(true);
    expect(providerKeyFor('alice@getzap.me')).toBe(OTHER);
  });

  it('keeps servers apart', () => {
    rememberProvider('alice@getzap.me', KEY);
    rememberProvider('bob@ln.nostrfeed.com', OTHER);

    expect(providerKeyFor('alice@getzap.me')).toBe(KEY);
    expect(providerKeyFor('bob@ln.nostrfeed.com')).toBe(OTHER);
  });
});

describe('providerKeyFor', () => {
  it('has no opinion about a server it has never met', () => {
    /*
     * Undefined is not a rejection. Treating it as one would empty the totals
     * of every author whose lightning server nobody here has happened to pay.
     */
    expect(providerKeyFor('stranger@example.com')).toBeUndefined();
  });

  it('has no opinion when there is no address at all', () => {
    expect(providerKeyFor(undefined)).toBeUndefined();
  });
});

describe('providerKeyForRecipients', () => {
  beforeEach(() => {
    rememberProvider('alice@getzap.me', KEY);
  });

  it('checks a note paid to one person', () => {
    expect(providerKeyForRecipients(['alice'], 'alice@getzap.me')).toBe(KEY);
  });

  it('withholds the check from a note with a zap split', () => {
    /*
     * A split pays several people who may be on different servers, and one
     * server's key would reject the receipts of everyone not on it — turning
     * a correct split into a note that appears to have earned nothing.
     */
    expect(
      providerKeyForRecipients(['alice', 'bob'], 'alice@getzap.me')
    ).toBeUndefined();
  });

  it('withholds the check when there is no recipient at all', () => {
    expect(providerKeyForRecipients([], 'alice@getzap.me')).toBeUndefined();
  });

  it('withholds the check for an unknown server', () => {
    expect(providerKeyForRecipients(['carol'], 'carol@example.com')).toBeUndefined();
  });
});
