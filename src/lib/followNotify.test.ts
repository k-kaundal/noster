import { describe, it, expect } from 'vitest';
import {
  EMPTY_LEDGER,
  MAX_REMEMBERED,
  rememberFollowers,
  unseenFollowers,
  type FollowerLedger,
} from './followNotify';

const seeded = (pubkeys: string[]): FollowerLedger => ({
  pubkeys,
  seeded: true,
});

describe('unseenFollowers', () => {
  it('reports nothing on the first look, however many came back', () => {
    // The whole follower list is history, not news — announcing it would greet
    // somebody with one notification per follower they have ever had
    expect(unseenFollowers(['a', 'b', 'c'], EMPTY_LEDGER)).toEqual([]);
  });

  it('reports a key it has never counted', () => {
    expect(unseenFollowers(['a', 'b'], seeded(['a']))).toEqual(['b']);
  });

  it('reports nothing when everyone is already known', () => {
    // The common case: a follower republished their contact list after editing
    // it, which is a new event carrying no news
    expect(unseenFollowers(['a', 'b'], seeded(['a', 'b']))).toEqual([]);
  });

  it('reports a follower once when two versions of their list arrive', () => {
    expect(unseenFollowers(['b', 'b'], seeded(['a']))).toEqual(['b']);
  });
});

describe('rememberFollowers', () => {
  it('marks itself seeded even when nothing came back', () => {
    // Otherwise an account with no followers stays unseeded forever, and the
    // first person to follow them is treated as history
    const ledger = rememberFollowers([], EMPTY_LEDGER);

    expect(ledger.seeded).toBe(true);
    expect(ledger.pubkeys).toEqual([]);
  });

  it('adds keys it had not seen', () => {
    expect(rememberFollowers(['b'], seeded(['a'])).pubkeys).toEqual(['a', 'b']);
  });

  it('returns the same object when nothing changed', () => {
    // So a caller can store it every poll without writing every poll
    const ledger = seeded(['a']);

    expect(rememberFollowers(['a'], ledger)).toBe(ledger);
  });

  it('does not record a key twice', () => {
    expect(rememberFollowers(['b', 'b'], seeded(['a'])).pubkeys).toEqual([
      'a',
      'b',
    ]);
  });

  it('caps what it keeps, dropping the oldest', () => {
    const full = seeded(
      Array.from({ length: MAX_REMEMBERED }, (_, index) => `k${index}`)
    );

    const ledger = rememberFollowers(['new'], full);

    expect(ledger.pubkeys).toHaveLength(MAX_REMEMBERED);
    expect(ledger.pubkeys.at(-1)).toBe('new');
    expect(ledger.pubkeys).not.toContain('k0');
  });
});

describe('the two together', () => {
  it('announces a follower once and never again', () => {
    let ledger = rememberFollowers(['a'], EMPTY_LEDGER);

    expect(unseenFollowers(['a', 'b'], ledger)).toEqual(['b']);
    ledger = rememberFollowers(['a', 'b'], ledger);

    // b republishes their contact list an hour later
    expect(unseenFollowers(['a', 'b'], ledger)).toEqual([]);
  });
});
