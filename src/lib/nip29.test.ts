import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  GROUP_ADMINS,
  GROUP_LIST,
  GROUP_METADATA,
  GROUP_PINS,
  GROUP_ROLES,
  PUT_USER,
  REMOVE_USER,
  acceptsKind,
  buildGroupListTags,
  buildGroupTree,
  buildPrevious,
  groupTags,
  isMember,
  parseGroupAdmins,
  parseGroupList,
  parseGroupMetadata,
  parseGroupPins,
  parseGroupReference,
  parseGroupRoles,
  rolesOf,
} from './nip29';

const RELAY_KEY = 'r'.repeat(64);
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey: RELAY_KEY,
    kind: GROUP_METADATA,
    content: '',
    tags: [],
    created_at: 1000,
    sig: '',
    ...overrides,
  };
}

function metadata(tags: string[][]) {
  return parseGroupMetadata(event({ tags }))!;
}

describe('parseGroupMetadata', () => {
  it('reads the group the spec describes', () => {
    const group = metadata([
      ['d', 'pizza'],
      ['name', 'Pizza Lovers'],
      ['picture', 'https://pizza.com/pizza.png'],
      ['about', 'a group for people who love pizza'],
      ['private'],
      ['closed'],
      ['supported_kinds', '9', '11'],
    ]);

    expect(group.id).toBe('pizza');
    expect(group.name).toBe('Pizza Lovers');
    expect(group.isPrivate).toBe(true);
    expect(group.isClosed).toBe(true);
    expect(group.supportedKinds).toEqual([9, 11]);
  });

  it('reads flags by presence, since they carry no value', () => {
    const group = metadata([['d', 'x'], ['restricted'], ['hidden'], ['livekit']]);

    expect(group.isRestricted).toBe(true);
    expect(group.isHidden).toBe(true);
    expect(group.hasLivekit).toBe(true);
    expect(group.isPrivate).toBe(false);
  });

  it('falls back to the id for a nameless group', () => {
    // The id is what the group is called on that relay, and what someone
    // would search for — more use than "Untitled"
    expect(metadata([['d', 'pizza']]).name).toBe('pizza');
  });

  it('needs a d tag, which is the group itself', () => {
    expect(parseGroupMetadata(event({ tags: [['name', 'x']] }))).toBeNull();
  });

  it('ignores events that are not group metadata', () => {
    expect(parseGroupMetadata(event({ kind: 1, tags: [['d', 'x']] }))).toBeNull();
  });
});

describe('acceptsKind', () => {
  it('accepts anything when the group does not say', () => {
    expect(acceptsKind(metadata([['d', 'x']]), 9)).toBe(true);
    expect(acceptsKind(metadata([['d', 'x']]), 30023)).toBe(true);
  });

  it('accepts only what is listed', () => {
    const group = metadata([['d', 'x'], ['supported_kinds', '9']]);

    expect(acceptsKind(group, 9)).toBe(true);
    expect(acceptsKind(group, 11)).toBe(false);
  });

  it('reads every kind in the tag, which carries a list', () => {
    // Unlike `child` and `role`, this is one tag with many values. Reading
    // only the first makes a group that takes threads look chat-only
    const group = metadata([['d', 'x'], ['supported_kinds', '9', '11', '30023']]);

    expect(group.supportedKinds).toEqual([9, 11, 30023]);
    expect(acceptsKind(group, 11)).toBe(true);
  });

  it('copes with a relay that splits the list across tags', () => {
    const group = metadata([
      ['d', 'x'],
      ['supported_kinds', '9'],
      ['supported_kinds', '11'],
    ]);

    expect(group.supportedKinds).toEqual([9, 11]);
  });

  it('accepts nothing when the list is empty, as an audio-only room', () => {
    // Distinct from an absent list: collapsing the two would show a text
    // composer in a room that rejects every message
    const group = metadata([['d', 'x'], ['supported_kinds']]);

    expect(group.supportedKinds).toEqual([]);
    expect(acceptsKind(group, 9)).toBe(false);
  });
});

describe('parseGroupAdmins', () => {
  const admins = parseGroupAdmins(
    event({
      kind: GROUP_ADMINS,
      tags: [
        ['d', 'pizza'],
        ['p', ALICE, 'ceo'],
        ['p', BOB, 'secretary', 'gardener'],
      ],
    })
  );

  it('reads each admin with every role they hold', () => {
    expect(admins).toEqual([
      { pubkey: ALICE, roles: ['ceo'] },
      { pubkey: BOB, roles: ['secretary', 'gardener'] },
    ]);
  });

  it('looks up roles by pubkey', () => {
    expect(rolesOf(admins, BOB)).toEqual(['secretary', 'gardener']);
    expect(rolesOf(admins, 'c'.repeat(64))).toEqual([]);
  });

  it('has nothing to say about a missing list', () => {
    expect(parseGroupAdmins(undefined)).toEqual([]);
  });
});

describe('parseGroupRoles', () => {
  it('reads the roles a relay supports, with descriptions', () => {
    const roles = parseGroupRoles(
      event({
        kind: GROUP_ROLES,
        tags: [['d', 'x'], ['role', 'admin', 'can do anything'], ['role', 'moderator']],
      })
    );

    expect(roles).toEqual([
      { name: 'admin', description: 'can do anything' },
      { name: 'moderator', description: undefined },
    ]);
  });
});

describe('parseGroupPins', () => {
  it('keeps regular and addressable pins in the order given', () => {
    const pins = parseGroupPins(
      event({
        kind: GROUP_PINS,
        tags: [['d', 'x'], ['e', 'first'], ['a', '30023:pk:slug'], ['e', 'second']],
      })
    );

    expect(pins).toEqual(['first', '30023:pk:slug', 'second']);
  });
});

describe('isMember', () => {
  const added = (at: number) =>
    event({ kind: PUT_USER, created_at: at, tags: [['h', 'x'], ['p', ALICE]] });
  const removed = (at: number) =>
    event({ kind: REMOVE_USER, created_at: at, tags: [['h', 'x'], ['p', ALICE]] });

  it('is false with no history at all', () => {
    expect(isMember([], ALICE)).toBe(false);
  });

  it('follows the newest decision, not the first one found', () => {
    // Both events live in the group's history forever, so someone removed and
    // re-added has one of each and reading either alone is wrong half the time
    expect(isMember([added(1000), removed(2000)], ALICE)).toBe(false);
    expect(isMember([removed(1000), added(2000)], ALICE)).toBe(true);
  });

  it('does not care what order the relay returned them in', () => {
    expect(isMember([removed(2000), added(1000)], ALICE)).toBe(false);
  });

  it('resolves a tie against membership', () => {
    // Same-second events are a relay quirk, not an ordering; guessing "member"
    // lets someone write into a group that will reject everything they send
    expect(isMember([added(1000), removed(1000)], ALICE)).toBe(false);
  });

  it('ignores decisions about other people', () => {
    expect(isMember([added(1000)], BOB)).toBe(false);
  });

  it('ignores events that are not membership decisions', () => {
    const chat = event({ kind: 9, created_at: 3000, tags: [['p', ALICE]] });
    expect(isMember([added(1000), chat], ALICE)).toBe(true);
  });
});

describe('buildPrevious', () => {
  const seen = (count: number, pubkey = BOB) =>
    Array.from({ length: count }, (_, index) =>
      event({
        id: `${index}`.padStart(8, '0').padEnd(64, 'f'),
        pubkey,
        created_at: 1000 + index,
      })
    );

  it('references the first eight characters of recent events', () => {
    const tag = buildPrevious(seen(5), ALICE);

    expect(tag[0]).toBe('previous');
    expect(tag.slice(1)).toHaveLength(3);
    for (const reference of tag.slice(1)) expect(reference).toHaveLength(8);
  });

  it('takes the newest first', () => {
    const tag = buildPrevious(seen(5), ALICE);
    expect(tag[1]).toBe('00000004');
  });

  it('excludes your own events, which prove nothing', () => {
    // Referencing only yourself is no evidence of having seen the conversation
    expect(buildPrevious(seen(5, ALICE), ALICE)).toEqual([]);
  });

  it('returns nothing rather than an empty tag when there is nothing to cite', () => {
    // Zero references is legal; a bare `["previous"]` is not
    expect(buildPrevious([], ALICE)).toEqual([]);
  });

  it('makes do with fewer than three', () => {
    expect(buildPrevious(seen(2), ALICE).slice(1)).toHaveLength(2);
  });
});

describe('groupTags', () => {
  it('always names the group', () => {
    expect(groupTags('pizza')).toEqual([['h', 'pizza']]);
  });

  it('adds timeline references when there is a timeline', () => {
    const seen = [event({ id: 'abcdef1234'.padEnd(64, '0'), pubkey: BOB })];
    const tags = groupTags('pizza', { seen, selfPubkey: ALICE });

    expect(tags).toEqual([['h', 'pizza'], ['previous', 'abcdef12']]);
  });

  it('leaves out an empty previous tag', () => {
    expect(groupTags('pizza', { seen: [], selfPubkey: ALICE })).toEqual([
      ['h', 'pizza'],
    ]);
  });
});

describe('parseGroupReference', () => {
  it('reads a plain group address', () => {
    expect(parseGroupReference('naddr1abc')).toEqual({ naddr: 'naddr1abc' });
  });

  it('reads an invite code off the end', () => {
    expect(parseGroupReference('naddr1abc?invite=xyz')).toEqual({
      naddr: 'naddr1abc',
      invite: 'xyz',
    });
  });

  it('leaves the address valid on its own, which is the point of the ?', () => {
    // `?` is outside the bech32 alphabet, so a client that knows nothing
    // about invites still resolves the group
    expect(parseGroupReference('naddr1abc?invite=xyz').naddr).toBe('naddr1abc');
  });

  it('ignores a nostr: prefix and surrounding space', () => {
    expect(parseGroupReference('  nostr:naddr1abc ')).toEqual({ naddr: 'naddr1abc' });
  });
});

describe('buildGroupTree', () => {
  const group = (id: string, tags: string[][] = []) =>
    metadata([['d', id], ...tags]);

  it('nests subgroups under their parent', () => {
    const tree = buildGroupTree([
      group('tech', [['child', 'nostr']]),
      group('nostr', [['parent', 'tech']]),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('tech');
    expect(tree[0].subgroups.map((node) => node.id)).toEqual(['nostr']);
  });

  it('follows the parent tag, not the child list', () => {
    // A `child` tag alone would let any group claim someone else's as its own
    const tree = buildGroupTree([group('tech', [['child', 'nostr']]), group('nostr')]);

    expect(tree.map((node) => node.id).sort()).toEqual(['nostr', 'tech']);
  });

  it('orders subgroups the way the parent listed them', () => {
    const tree = buildGroupTree([
      group('tech', [['child', 'b'], ['child', 'a']]),
      group('a', [['parent', 'tech']]),
      group('b', [['parent', 'tech']]),
    ]);

    expect(tree[0].subgroups.map((node) => node.id)).toEqual(['b', 'a']);
  });

  it('keeps an orphan visible as a root', () => {
    // Its parent is on another relay or gone; still worth showing
    const tree = buildGroupTree([group('nostr', [['parent', 'missing']])]);
    expect(tree.map((node) => node.id)).toEqual(['nostr']);
  });

  it('does not lose a group that names itself as its parent', () => {
    const tree = buildGroupTree([group('loop', [['parent', 'loop']])]);
    expect(tree.map((node) => node.id)).toEqual(['loop']);
  });

  it('nests to any depth', () => {
    const tree = buildGroupTree([
      group('tech'),
      group('nostr', [['parent', 'tech']]),
      group('nip29', [['parent', 'nostr']]),
    ]);

    expect(tree[0].subgroups[0].subgroups[0].id).toBe('nip29');
  });
});

describe('group list', () => {
  it('reads groups with their relays and names', () => {
    const list = parseGroupList(
      event({
        kind: GROUP_LIST,
        tags: [
          ['group', 'pizza', 'wss://groups.example', 'Pizza Lovers'],
          ['group', 'bare'],
          ['r', 'wss://groups.example'],
        ],
      })
    );

    expect(list).toEqual([
      { id: 'pizza', relay: 'wss://groups.example', name: 'Pizza Lovers' },
      { id: 'bare', relay: undefined, name: undefined },
    ]);
  });

  it('round-trips', () => {
    const groups = [{ id: 'pizza', relay: 'wss://groups.example', name: 'Pizza' }];
    const tags = buildGroupListTags(groups);

    expect(parseGroupList(event({ kind: GROUP_LIST, tags }))).toEqual(groups);
  });

  it('lists every relay in use, as NIP-51 asks', () => {
    // Redundant with the group tags, and the only thing to connect to when a
    // group's own relay has gone quiet
    const tags = buildGroupListTags([
      { id: 'a', relay: 'wss://one' },
      { id: 'b', relay: 'wss://two' },
      { id: 'c', relay: 'wss://one' },
    ]);

    expect(tags.filter(([name]) => name === 'r')).toEqual([
      ['r', 'wss://one'],
      ['r', 'wss://two'],
    ]);
  });

  it('keeps the same id on two relays, which are two different groups', () => {
    const tags = buildGroupListTags([
      { id: 'pizza', relay: 'wss://one' },
      { id: 'pizza', relay: 'wss://two' },
    ]);

    expect(tags.filter(([name]) => name === 'group')).toHaveLength(2);
  });

  it('drops an exact duplicate', () => {
    const tags = buildGroupListTags([
      { id: 'pizza', relay: 'wss://one' },
      { id: 'pizza', relay: 'wss://one' },
    ]);

    expect(tags.filter(([name]) => name === 'group')).toHaveLength(1);
  });

  it('does not let a name slide into the relay position', () => {
    // Positional tags: a name written where the relay goes would send readers
    // to a relay called "Pizza"
    const tags = buildGroupListTags([{ id: 'pizza', name: 'Pizza' }]);
    expect(tags[0]).toEqual(['group', 'pizza', '', 'Pizza']);
  });
});
