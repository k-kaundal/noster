import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  APPROVAL_KIND,
  COMMUNITY_KIND,
  approvedPostIds,
  buildCommunityTags,
  canModerate,
  communityAddress,
  isPostFor,
  parseAddress,
  parseCommunity,
  groupCommunities,
  roleIn,
  type Community,
} from './community';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const MALLORY = 'c'.repeat(64);

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'id',
    pubkey: ALICE,
    kind: COMMUNITY_KIND,
    content: '',
    tags: [['d', 'builders']],
    created_at: 1000,
    sig: '',
    ...overrides,
  };
}

describe('parseCommunity', () => {
  it('reads the definition', () => {
    const community = parseCommunity(
      event({
        tags: [
          ['d', 'builders'],
          ['name', 'Bitcoin builders'],
          ['description', 'People who ship'],
          ['image', 'https://x/banner.png'],
          ['relay', 'wss://relay.example', 'requests'],
        ],
      })
    );

    expect(community).toMatchObject({
      slug: 'builders',
      name: 'Bitcoin builders',
      description: 'People who ship',
      image: 'https://x/banner.png',
      relays: [{ url: 'wss://relay.example', marker: 'requests' }],
    });
  });

  it('falls back to the slug when there is no name', () => {
    expect(parseCommunity(event())?.name).toBe('builders');
  });

  it('rejects a definition with no d tag, which has no address', () => {
    expect(parseCommunity(event({ tags: [['name', 'Nameless']] }))).toBeNull();
  });

  it('rejects another kind', () => {
    expect(parseCommunity(event({ kind: 1 }))).toBeNull();
  });

  it('counts the creator as a moderator even if untagged', () => {
    // Otherwise a community made without a self-tag has nobody who can
    // approve anything, including the person who made it
    expect(parseCommunity(event())?.moderators).toEqual([ALICE]);
  });

  it('reads tagged moderators', () => {
    const community = parseCommunity(
      event({
        tags: [
          ['d', 'builders'],
          ['p', BOB, '', 'moderator'],
        ],
      })
    );

    expect(community?.moderators).toEqual([ALICE, BOB]);
  });

  it('ignores a p tag that is not marked as a moderator', () => {
    const community = parseCommunity(
      event({
        tags: [
          ['d', 'builders'],
          ['p', MALLORY],
        ],
      })
    );

    expect(community?.moderators).toEqual([ALICE]);
  });
});

describe('communityAddress and parseAddress', () => {
  it('round-trips', () => {
    const address = communityAddress({ creator: ALICE, slug: 'builders' });

    expect(address).toBe(`${COMMUNITY_KIND}:${ALICE}:builders`);
    expect(parseAddress(address)).toEqual({
      kind: COMMUNITY_KIND,
      pubkey: ALICE,
      identifier: 'builders',
    });
  });

  it('keeps an identifier that contains colons intact', () => {
    expect(parseAddress(`34550:${ALICE}:a:b:c`)?.identifier).toBe('a:b:c');
  });

  it('rejects a malformed coordinate', () => {
    expect(parseAddress('not-an-address')).toBeNull();
  });
});

describe('buildCommunityTags', () => {
  const base = {
    slug: 'builders',
    name: 'Bitcoin builders',
    description: '',
    moderators: [] as string[],
    relays: [] as string[],
  };

  it('always carries the address', () => {
    expect(buildCommunityTags(base)[0]).toEqual(['d', 'builders']);
  });

  it('marks moderators so they are recognised as such', () => {
    const tags = buildCommunityTags({ ...base, moderators: [BOB] });

    expect(tags).toContainEqual(['p', BOB, '', 'moderator']);
  });

  it('drops anything that is not a valid pubkey', () => {
    // A typo silently granting nobody is better than one granting everybody,
    // but either way it must not end up in the tags looking legitimate
    const tags = buildCommunityTags({
      ...base,
      moderators: ['not-a-key', BOB, ''],
    });

    expect(tags.filter(([name]) => name === 'p')).toEqual([
      ['p', BOB, '', 'moderator'],
    ]);
  });

  it('does not list the same moderator twice', () => {
    const tags = buildCommunityTags({
      ...base,
      moderators: [BOB, BOB.toUpperCase()],
    });

    expect(tags.filter(([name]) => name === 'p')).toHaveLength(1);
  });

  it('leaves out empty optional fields', () => {
    const tags = buildCommunityTags(base);

    expect(tags.some(([name]) => name === 'description')).toBe(false);
    expect(tags.some(([name]) => name === 'image')).toBe(false);
  });
});

describe('approvedPostIds', () => {
  function approval(pubkey: string, postId: string): NostrEvent {
    return event({
      pubkey,
      kind: APPROVAL_KIND,
      tags: [['e', postId]],
    });
  }

  it('collects posts a moderator approved', () => {
    const ids = approvedPostIds(
      [approval(ALICE, 'post-1'), approval(BOB, 'post-2')],
      [ALICE, BOB]
    );

    expect([...ids].sort()).toEqual(['post-1', 'post-2']);
  });

  it('ignores an approval from someone who is not a moderator', () => {
    // Without this a spammer approves their own posts into any community
    const ids = approvedPostIds([approval(MALLORY, 'spam')], [ALICE]);

    expect(ids.size).toBe(0);
  });

  it('ignores events that are not approvals', () => {
    const ids = approvedPostIds(
      [event({ pubkey: ALICE, kind: 1, tags: [['e', 'post-1']] })],
      [ALICE]
    );

    expect(ids.size).toBe(0);
  });

  it('handles an approval covering several posts', () => {
    const many = event({
      pubkey: ALICE,
      kind: APPROVAL_KIND,
      tags: [
        ['e', 'post-1'],
        ['e', 'post-2'],
      ],
    });

    expect(approvedPostIds([many], [ALICE]).size).toBe(2);
  });
});

describe('canModerate', () => {
  const community = parseCommunity(
    event({
      tags: [
        ['d', 'builders'],
        ['p', BOB, '', 'moderator'],
      ],
    })
  );

  it('allows the creator and tagged moderators', () => {
    expect(canModerate(community, ALICE)).toBe(true);
    expect(canModerate(community, BOB)).toBe(true);
  });

  it('refuses everyone else', () => {
    expect(canModerate(community, MALLORY)).toBe(false);
  });

  it('refuses when nobody is signed in', () => {
    expect(canModerate(community, undefined)).toBe(false);
    expect(canModerate(null, ALICE)).toBe(false);
  });
});

describe('isPostFor', () => {
  const address = `${COMMUNITY_KIND}:${ALICE}:builders`;

  it('matches a post addressed to the community', () => {
    expect(isPostFor(event({ kind: 1111, tags: [['a', address]] }), address)).toBe(
      true
    );
  });

  it('does not match a post addressed elsewhere', () => {
    expect(
      isPostFor(
        event({ kind: 1111, tags: [['a', `${COMMUNITY_KIND}:${BOB}:other`]] }),
        address
      )
    ).toBe(false);
  });
});

describe('roleIn', () => {
  const community = {
    creator: 'creator-key',
    moderators: ['creator-key', 'mod-key'],
  };

  it('ranks the creator above the moderators they appointed', () => {
    // Somebody who made a place is not merely one of its moderators
    expect(roleIn(community, 'creator-key')).toBe('creator');
    expect(roleIn(community, 'mod-key')).toBe('moderator');
  });

  it('is nothing for a visitor, or for nobody', () => {
    expect(roleIn(community, 'stranger')).toBeNull();
    expect(roleIn(community, undefined)).toBeNull();
  });
});

describe('groupCommunities', () => {
  function make(overrides: Partial<Community>): Community {
    return {
      slug: 'slug',
      name: 'name',
      description: '',
      creator: 'someone',
      moderators: [],
      relays: [],
      createdAt: 0,
      event: {
        id: 'id',
        pubkey: 'someone',
        kind: 34550,
        content: '',
        tags: [],
        created_at: 0,
        sig: '',
      },
      ...overrides,
    };
  }

  const mineOld = make({ slug: 'a', creator: 'me', createdAt: 100 });
  const mineNew = make({ slug: 'b', creator: 'me', createdAt: 300 });
  const modded = make({ slug: 'c', creator: 'other', moderators: ['me'], createdAt: 200 });
  const theirs = make({ slug: 'd', creator: 'other', createdAt: 400 });

  it('separates what somebody runs from what merely exists', () => {
    /**
     * One flat grid meant a moderator arriving to tend their own community
     * had to find it among fifty they have nothing to do with.
     */
    const { mine, rest } = groupCommunities(
      [theirs, modded, mineNew, mineOld],
      'me'
    );

    expect(mine.map((c) => c.slug)).toEqual(['a', 'b', 'c']);
    expect(rest.map((c) => c.slug)).toEqual(['d']);
  });

  it('puts creations above the ones they only help run', () => {
    const { mine } = groupCommunities([modded, mineNew], 'me');

    expect(mine.map((c) => c.slug)).toEqual(['b', 'c']);
  });

  it('gives a signed-out reader nothing of their own', () => {
    const { mine, rest } = groupCommunities([mineOld, theirs], undefined);

    expect(mine).toEqual([]);
    expect(rest).toHaveLength(2);
  });
});
