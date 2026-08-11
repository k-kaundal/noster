import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  reconcileAuthor,
  shouldReplaceProfile,
  type CachedAuthor,
} from './authorCache';

function profile(created_at: number, name = 'alice'): NostrEvent {
  return {
    id: `id-${created_at}`,
    pubkey: 'abc',
    kind: 0,
    created_at,
    tags: [],
    content: JSON.stringify({ name }),
    sig: '',
  };
}

describe('shouldReplaceProfile', () => {
  it('accepts a profile when nothing is cached', () => {
    expect(shouldReplaceProfile(profile(100), undefined)).toBe(true);
  });

  it('accepts a newer one', () => {
    expect(shouldReplaceProfile(profile(200), profile(100))).toBe(true);
  });

  it('refuses an older one', () => {
    // A slow relay answering after the fact, or a second device catching up,
    // must not put a stale name back on screen
    expect(shouldReplaceProfile(profile(100), profile(200))).toBe(false);
  });

  it('accepts one with the same timestamp', () => {
    // Two saves in the same second are the same person editing twice, and the
    // later arrival is the later intent
    expect(shouldReplaceProfile(profile(100, 'new'), profile(100, 'old'))).toBe(
      true
    );
  });
});

describe('reconcileAuthor', () => {
  it('takes a fetched profile', () => {
    const fetched: CachedAuthor = { event: profile(100) };
    expect(reconcileAuthor(fetched, undefined)).toBe(fetched);
  });

  it('keeps a known profile when the lookup finds nothing', () => {
    // The bug this exists for: a relay with no kind 0 for a key is not
    // evidence the profile is gone, and letting it win wipes a profile that
    // was just published and not yet indexed
    const known: CachedAuthor = { event: profile(100) };
    expect(reconcileAuthor({}, known)).toBe(known);
  });

  it('lets a fetched profile replace a known one', () => {
    const fetched: CachedAuthor = { event: profile(200) };
    expect(reconcileAuthor(fetched, { event: profile(100) })).toBe(fetched);
  });

  it('reports nothing when nothing is known either way', () => {
    // A key with genuinely no profile must still resolve, or every consumer
    // waits forever on a query that never settles
    expect(reconcileAuthor({}, undefined)).toEqual({});
    expect(reconcileAuthor({}, {})).toEqual({});
  });
});
