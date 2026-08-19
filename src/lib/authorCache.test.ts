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

  it('refuses a fetched profile that is older than the one in hand', () => {
    /*
     * The bug behind "I saved my profile and it changed back".
     *
     * Saving seeds the signed event into the cache, the refetch that follows
     * reaches relays that have not indexed it yet, and they answer with the
     * previous kind 0. This used to take any event at all — `if
     * (fetched.event) return fetched` — so the stale answer won for arriving
     * second, and the edit was published correctly and then thrown off the
     * screen.
     */
    const justSaved: CachedAuthor = { event: profile(200, 'new name') };
    const staleFromRelay: CachedAuthor = { event: profile(100, 'old name') };

    expect(reconcileAuthor(staleFromRelay, justSaved)).toBe(justSaved);
  });

  it('takes a fetched profile with the same timestamp', () => {
    // The same event coming back around; either is correct, and preferring
    // the fetch keeps this agreeing with `shouldReplaceProfile`
    const fetched: CachedAuthor = { event: profile(100, 'a') };
    expect(reconcileAuthor(fetched, { event: profile(100, 'b') })).toBe(fetched);
  });

  it('keeps a known profile when the fetch has metadata but no event', () => {
    // Metadata without an event cannot be dated, so it cannot be shown to be
    // newer than something that can
    const known: CachedAuthor = { event: profile(100) };
    expect(reconcileAuthor({ metadata: { name: 'x' } }, known)).toBe(known);
  });

  it('reports nothing when nothing is known either way', () => {
    // A key with genuinely no profile must still resolve, or every consumer
    // waits forever on a query that never settles
    expect(reconcileAuthor({}, undefined)).toEqual({});
    expect(reconcileAuthor({}, {})).toEqual({});
  });
});
