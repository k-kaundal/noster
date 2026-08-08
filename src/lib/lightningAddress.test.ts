import { describe, it, expect } from 'vitest';
import {
  buildPayLinkBody,
  suggestUsername,
  validateUsername,
} from './lightningAddress';

describe('suggestUsername', () => {
  it('lowercases and strips spaces from a display name', () => {
    expect(suggestUsername('Satoshi Nakamoto')).toBe('satoshinakamoto');
  });

  it('keeps the punctuation a lightning address allows', () => {
    expect(suggestUsername('a.b-c_d')).toBe('a.b-c_d');
  });

  it('folds accents down instead of dropping the letter', () => {
    // Losing the character entirely would turn "José" into "jos"
    expect(suggestUsername('José')).toBe('jose');
    expect(suggestUsername('Æther')).toBe('aether');
  });

  it('spells out letters normalisation refuses to decompose', () => {
    // These are distinct letters, not accented ones, so NFKD leaves them whole
    // and the ASCII filter would otherwise delete them
    expect(suggestUsername('Ærik')).toBe('aerik');
    expect(suggestUsername('Søren')).toBe('soren');
    expect(suggestUsername('Straße')).toBe('strasse');
    expect(suggestUsername('Łukasz')).toBe('lukasz');
  });

  it('drops emoji and other characters an address cannot carry', () => {
    expect(suggestUsername('bitcoin🔥maxi')).toBe('bitcoinmaxi');
  });

  it('trims punctuation off the ends, which reads as a typo', () => {
    expect(suggestUsername('.alice.')).toBe('alice');
    expect(suggestUsername('--bob--')).toBe('bob');
  });

  it('caps the length', () => {
    expect(suggestUsername('a'.repeat(80))).toHaveLength(32);
  });

  it('returns empty rather than garbage for an unusable name', () => {
    expect(suggestUsername('🔥🔥🔥')).toBe('');
    expect(suggestUsername('   ')).toBe('');
  });
});

describe('validateUsername', () => {
  it('accepts an ordinary name', () => {
    expect(validateUsername('satoshi')).toBeNull();
    expect(validateUsername('a.b-c_d')).toBeNull();
  });

  it('rejects names that are too short or too long', () => {
    expect(validateUsername('a')).toBe('too-short');
    expect(validateUsername('')).toBe('too-short');
    expect(validateUsername('a'.repeat(33))).toBe('too-long');
  });

  it('rejects characters a lightning address cannot carry', () => {
    expect(validateUsername('Satoshi')).toBe('invalid-characters');
    expect(validateUsername('a b')).toBe('invalid-characters');
    expect(validateUsername('a@b')).toBe('invalid-characters');
  });

  it('rejects leading or trailing punctuation', () => {
    expect(validateUsername('.alice')).toBe('edge-punctuation');
    expect(validateUsername('alice.')).toBe('edge-punctuation');
    expect(validateUsername('_alice')).toBe('edge-punctuation');
  });

  it('accepts everything suggestUsername produces from a real name', () => {
    for (const name of ['Satoshi Nakamoto', 'José', 'bitcoin🔥maxi', 'a.b-c']) {
      const suggested = suggestUsername(name);
      expect(validateUsername(suggested), name).toBeNull();
    }
  });
});

describe('buildPayLinkBody', () => {
  const body = buildPayLinkBody({
    username: 'satoshi',
    walletId: 'wallet-1',
    displayName: 'Satoshi',
  });

  it('is not disposable, which the API otherwise defaults to', () => {
    // A disposable link stops working after one payment — useless as an address
    expect(body.disposable).toBe(false);
  });

  it('enables zaps', () => {
    expect(body.zaps).toBe(true);
  });

  it('allows a comment, which is where a zap message travels', () => {
    // The API defaults to 0, which would silently discard every zap note
    expect(body.comment_chars).toBeGreaterThan(0);
  });

  it('spans a usable amount range', () => {
    expect(body.min).toBe(1);
    expect(body.max).toBeGreaterThan(1_000_000);
  });

  it('carries the username and wallet through', () => {
    expect(body.username).toBe('satoshi');
    expect(body.wallet).toBe('wallet-1');
  });

  it('falls back to a generic description without a display name', () => {
    const anonymous = buildPayLinkBody({
      username: 'satoshi',
      walletId: 'wallet-1',
    });
    expect(anonymous.description).toBeTruthy();
  });
});
