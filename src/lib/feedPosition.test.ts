import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { countUnseen, markerFor } from './feedPosition';

/** Newest first, as the feed renders them. */
function feed(...timestamps: number[]): NostrEvent[] {
  return timestamps.map((created_at) => ({
    id: `note-${created_at}`,
    pubkey: 'a',
    kind: 1,
    created_at,
    tags: [],
    content: 'x',
    sig: '',
  }));
}

describe('countUnseen', () => {
  it('is zero before the reader has a position', () => {
    expect(countUnseen(feed(300, 200, 100), null)).toBe(0);
    expect(countUnseen(undefined, { id: 'n', created_at: 1 })).toBe(0);
    expect(countUnseen([], { id: 'n', created_at: 1 })).toBe(0);
  });

  it('is zero when nothing has arrived above them', () => {
    const posts = feed(300, 200, 100);
    expect(countUnseen(posts, markerFor(posts[0]))).toBe(0);
  });

  it('counts notes that arrived above them', () => {
    const posts = feed(300, 200, 100);
    const marker = markerFor(posts[0]);
    expect(countUnseen(feed(500, 400, 300, 200, 100), marker)).toBe(2);
  });

  it('still counts when the marked note has been evicted', () => {
    // The bug. The sixty-second poll replaces the first page with the newest
    // thirty notes and the live cap drops the page's tail, so on a busy feed
    // the marked note routinely disappears. Looking it up by id then failed,
    // the count fell to zero, and every held-back note rendered at once —
    // the exact jump the hold-back exists to prevent
    const marker = { id: 'note-300', created_at: 300 };
    expect(countUnseen(feed(500, 400, 250, 200), marker)).toBe(2);
  });

  it('holds nothing back when every note predates the marker', () => {
    const marker = { id: 'note-300', created_at: 300 };
    expect(countUnseen(feed(200, 100), marker)).toBe(0);
  });

  it('shows the list when nothing on it overlaps what they had seen', () => {
    // No shared note and no older note either: there is no reading position
    // left to protect, and holding everything back would leave an empty
    // timeline under a pill saying there are posts
    const marker = { id: 'note-100', created_at: 100 };
    expect(countUnseen(feed(500, 400, 300), marker)).toBe(0);
  });

  it('treats a note sharing the marker timestamp as seen', () => {
    // Two notes in the same second are ordered arbitrarily; counting one as
    // new would leave a permanent "1 new post" that never clears
    const marker = { id: 'note-300', created_at: 300 };
    expect(countUnseen(feed(400, 300, 200), marker)).toBe(1);
  });
});

describe('markerFor', () => {
  it('records the id and the moment', () => {
    expect(markerFor(feed(300)[0])).toEqual({ id: 'note-300', created_at: 300 });
  });

  it('is null when there is nothing to mark', () => {
    expect(markerFor(undefined)).toBeNull();
  });
});
