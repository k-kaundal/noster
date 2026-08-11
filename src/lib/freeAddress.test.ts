import { describe, it, expect } from 'vitest';
import {
  generateFreeName,
  hasChosenName,
  isGeneratedName,
  mayClaim,
} from './freeAddress';
import { validateUsername } from './lightningAddress';

const PUBKEY =
  'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6';
const OTHER =
  'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd';

describe('generateFreeName', () => {
  it('is stable for a key', () => {
    // The address gets handed to people and published in a profile; a name
    // that changed per device would break both
    expect(generateFreeName(PUBKEY)).toBe(generateFreeName(PUBKEY));
    expect(generateFreeName(PUBKEY)).toBe('uf1ee81bb8437');
  });

  it('differs between keys, so nobody has to check availability', () => {
    expect(generateFreeName(PUBKEY)).not.toBe(generateFreeName(OTHER));
  });

  it('produces a name the address issuer will accept', () => {
    // LUD-16 restricts the local part; a generated name that fails validation
    // would leave someone with no address at all
    expect(validateUsername(generateFreeName(PUBKEY))).toBeNull();
    expect(validateUsername(generateFreeName(OTHER))).toBeNull();
  });

  it('ignores case and an npub-ish prefix in what it is given', () => {
    expect(generateFreeName(PUBKEY.toUpperCase())).toBe(generateFreeName(PUBKEY));
    expect(generateFreeName(`  ${PUBKEY}  `)).toBe(generateFreeName(PUBKEY));
  });

  it('still produces something usable for a short or malformed key', () => {
    // Better a padded name than an empty local part, which is rejected and
    // leaves the person with nothing
    expect(validateUsername(generateFreeName('abc'))).toBeNull();
    expect(validateUsername(generateFreeName(''))).toBeNull();
  });
});

describe('isGeneratedName', () => {
  it('recognises a name this app assigned', () => {
    expect(isGeneratedName(generateFreeName(PUBKEY))).toBe(true);
  });

  it('does not mistake a chosen name for an assigned one', () => {
    // Deciding wrongly here either hides the upgrade from someone on a free
    // address, or offers to sell a name to someone who already bought one
    for (const name of ['alice', 'satoshi', 'user', 'u123', 'ufffff']) {
      expect(isGeneratedName(name)).toBe(false);
    }
  });

  it('does not match a chosen name that merely starts the same way', () => {
    expect(isGeneratedName('uf1ee81bb8437x')).toBe(false);
    expect(isGeneratedName('uf1ee81bb84')).toBe(false);
  });

  it('matches regardless of case or padding', () => {
    expect(isGeneratedName('  UF1EE81BB8437 ')).toBe(true);
  });
});

describe('hasChosenName', () => {
  it('is false while still on the assigned name', () => {
    expect(hasChosenName(generateFreeName(PUBKEY))).toBe(false);
  });

  it('is true once a name was picked', () => {
    expect(hasChosenName('alice')).toBe(true);
  });

  it('is false when there is no name at all', () => {
    expect(hasChosenName(null)).toBe(false);
    expect(hasChosenName(undefined)).toBe(false);
    expect(hasChosenName('')).toBe(false);
  });
});

describe('mayClaim', () => {
  const free = generateFreeName(PUBKEY);
  const entitlement = { freeName: free, paidNames: [], ownedNames: [] };

  it('allows the name assigned to their key', () => {
    expect(mayClaim(free, entitlement)).toBe(true);
  });

  it('refuses a chosen name nobody paid for', () => {
    // The whole free tier rests on this: the claim endpoint takes any name,
    // so without the check `alice` is free to whoever types it first
    expect(mayClaim('alice', entitlement)).toBe(false);
    expect(mayClaim('satoshi', entitlement)).toBe(false);
  });

  it('refuses the name derived from somebody else’s key', () => {
    expect(mayClaim(generateFreeName(OTHER), entitlement)).toBe(false);
  });

  it('allows a name that was bought', () => {
    expect(mayClaim('alice', { ...entitlement, paidNames: ['alice'] })).toBe(true);
  });

  it('allows re-claiming a name already held', () => {
    // Reconnecting on a second device re-runs the claim; refusing it here
    // would lock someone out of the address they are already using
    expect(mayClaim('alice', { ...entitlement, ownedNames: ['alice'] })).toBe(true);
  });

  it('ignores case and surrounding space on both sides', () => {
    expect(mayClaim(' ALICE ', { ...entitlement, paidNames: ['alice'] })).toBe(true);
    expect(mayClaim('alice', { ...entitlement, paidNames: [' Alice'] })).toBe(true);
  });

  it('tolerates pay links with no username on them', () => {
    // LNbits allows a pay link with no address at all; it should not widen
    // what an empty request is allowed to claim
    expect(mayClaim('', { ...entitlement, ownedNames: [undefined] })).toBe(false);
    expect(mayClaim('alice', { ...entitlement, ownedNames: [undefined] })).toBe(false);
  });
});
