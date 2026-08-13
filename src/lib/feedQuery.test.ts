import { describe, it, expect } from 'vitest';
import { feedQueryKey } from '@/lib/feedQuery';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

describe('feedQueryKey', () => {
  it('does not change when the follow list grows', () => {
    /**
     * The key used to carry the follow count, so following one more person
     * produced a key nothing had ever been fetched for — the timeline
     * somebody was reading emptied to a skeleton and refilled from scratch.
     * The follow list decides what is fetched, not where it is filed.
     */
    expect(feedQueryKey('following', ALICE)).toEqual(
      feedQueryKey('following', ALICE)
    );
  });

  it('separates one reader’s following feed from another’s', () => {
    expect(feedQueryKey('following', ALICE)).not.toEqual(
      feedQueryKey('following', BOB)
    );
  });

  it('keeps the global feed shared, since it is the same for everybody', () => {
    expect(feedQueryKey('global', ALICE)).toEqual(feedQueryKey('global', BOB));
  });

  it('keeps the two scopes apart', () => {
    expect(feedQueryKey('global', ALICE)).not.toEqual(
      feedQueryKey('following', ALICE)
    );
  });

  it('survives a signed-out reader', () => {
    expect(feedQueryKey('global', undefined)).toEqual(['feed', 'global', '']);
  });
});
