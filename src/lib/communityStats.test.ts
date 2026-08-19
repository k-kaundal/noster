import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  activityByCommunity,
  describeActivity,
  ownPending,
  summarizeCommunity,
} from './communityStats';

const NOW = 1_700_000_000_000;
const seconds = Math.floor(NOW / 1000);
const DAY = 86400;

function post(pubkey: string, createdAt = seconds): NostrEvent {
  return {
    id: `${pubkey}-${createdAt}`,
    kind: 1111,
    pubkey,
    created_at: createdAt,
    content: 'hello',
    tags: [],
    sig: '',
  };
}

describe('summarizeCommunity', () => {
  it('counts people, not just posts', () => {
    /*
     * Forty posts from one person and forty from thirty people are not the
     * same board, and a total on its own cannot tell them apart.
     */
    const stats = summarizeCommunity(
      [post('alice'), post('alice'), post('bob')],
      []
    );

    expect(stats.approved).toBe(3);
    expect(stats.contributors).toBe(2);
  });

  it('reports the queue separately from the board', () => {
    const stats = summarizeCommunity([post('alice')], [post('bob'), post('cy')]);

    expect(stats.approved).toBe(1);
    expect(stats.pending).toBe(2);
  });

  it('takes the newest approved post as the last activity', () => {
    const stats = summarizeCommunity(
      [post('alice', seconds - 10 * DAY), post('bob', seconds - DAY)],
      []
    );

    expect(stats.lastPostAt).toBe(seconds - DAY);
  });

  it('has no last activity when nothing is approved', () => {
    // A queue full of unapproved posts is not activity on the board
    expect(summarizeCommunity([], [post('bob')]).lastPostAt).toBeUndefined();
  });

  it('says nothing about an empty community', () => {
    expect(summarizeCommunity([], [])).toEqual({
      approved: 0,
      pending: 0,
      contributors: 0,
      lastPostAt: undefined,
    });
  });
});

describe('describeActivity', () => {
  const ago = (days: number) => seconds - days * DAY;

  it('answers at the coarseness people care about', () => {
    expect(describeActivity(ago(0), NOW)).toBe('Active today');
    expect(describeActivity(ago(1), NOW)).toBe('Active yesterday');
    expect(describeActivity(ago(3), NOW)).toBe('Active 3 days ago');
    expect(describeActivity(ago(10), NOW)).toBe('Active 1 week ago');
    expect(describeActivity(ago(60), NOW)).toBe('Quiet for 2 months');
    expect(describeActivity(ago(800), NOW)).toBe('Quiet for 2 years');
  });

  it('turns from active to quiet at a month, which is the real judgement', () => {
    // "Active 5 weeks ago" flatters a board nobody has posted to since
    expect(describeActivity(ago(20), NOW)).toMatch(/^Active/);
    expect(describeActivity(ago(40), NOW)).toMatch(/^Quiet/);
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeActivity(undefined, NOW)).toBeNull();
  });

  it('does not report the future as ancient', () => {
    // A post stamped slightly ahead by another machine's clock is "today"
    expect(describeActivity(seconds + 600, NOW)).toBe('Active today');
  });
});

describe('ownPending', () => {
  it('picks out the posts you are waiting on', () => {
    /*
     * The most confusing thing about a moderated board: you post, you are told
     * a moderator has to approve it, and your post is then indistinguishable
     * from strangers' in a tab called "Unapproved".
     */
    const mine = ownPending([post('alice'), post('bob')], 'alice');

    expect(mine).toHaveLength(1);
    expect(mine[0].pubkey).toBe('alice');
  });

  it('has nothing to show a signed-out reader', () => {
    expect(ownPending([post('alice')], undefined)).toEqual([]);
  });
});

describe('activityByCommunity', () => {
  const ADDRESS = '34550:abc:rust';
  const OTHER = '34550:abc:go';

  function approval(
    address: string,
    postId: string,
    createdAt = seconds
  ): NostrEvent {
    return {
      id: `${address}-${postId}-${createdAt}`,
      kind: 4550,
      pubkey: 'mod',
      created_at: createdAt,
      content: '{}',
      tags: [
        ['a', address],
        ['e', postId],
      ],
      sig: '',
    };
  }

  it('answers for every community in one pass', () => {
    /*
     * The whole reason it reads approvals rather than posts: an approval names
     * its community in an `a` tag, so one query carrying every address on the
     * page answers for all of them.
     */
    const activity = activityByCommunity([
      approval(ADDRESS, 'p1'),
      approval(ADDRESS, 'p2'),
      approval(OTHER, 'p3'),
    ]);

    expect(activity.get(ADDRESS)?.posts).toBe(2);
    expect(activity.get(OTHER)?.posts).toBe(1);
  });

  it('counts a post once however many moderators approved it', () => {
    // Two moderators approving the same post is one post on the board
    const activity = activityByCommunity([
      approval(ADDRESS, 'p1'),
      approval(ADDRESS, 'p1'),
    ]);

    expect(activity.get(ADDRESS)?.posts).toBe(1);
  });

  it('takes the newest approval as the last activity', () => {
    const activity = activityByCommunity([
      approval(ADDRESS, 'p1', seconds - 10 * DAY),
      approval(ADDRESS, 'p2', seconds - DAY),
    ]);

    expect(activity.get(ADDRESS)?.lastPostAt).toBe(seconds - DAY);
  });

  it('ignores an approval that names no community or no post', () => {
    const broken: NostrEvent = {
      ...approval(ADDRESS, 'p1'),
      tags: [['a', ADDRESS]],
    };

    expect(activityByCommunity([broken]).size).toBe(0);
  });

  it('has nothing to say about nothing', () => {
    expect(activityByCommunity([]).size).toBe(0);
  });
});
