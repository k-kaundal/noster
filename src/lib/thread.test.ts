import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  buildReplyTags,
  buildReplyTree,
  countDescendants,
  descendantsOf,
  getThreadPosition,
  isReply,
} from './thread';

function note(
  id: string,
  tags: string[][] = [],
  overrides: Partial<NostrEvent> = {}
): NostrEvent {
  return {
    id,
    pubkey: `pubkey-${id}`,
    kind: 1,
    content: id,
    tags,
    created_at: 1000,
    sig: '',
    ...overrides,
  };
}

describe('getThreadPosition', () => {
  it('reports no position for a top-level note', () => {
    expect(getThreadPosition(note('a'))).toEqual({
      rootId: null,
      parentId: null,
    });
  });

  it('reads the marked form', () => {
    const event = note('c', [
      ['e', 'a', '', 'root'],
      ['e', 'b', '', 'reply'],
    ]);

    expect(getThreadPosition(event)).toEqual({ rootId: 'a', parentId: 'b' });
  });

  it('treats a lone root marker as the parent too', () => {
    const event = note('b', [['e', 'a', '', 'root']]);

    expect(getThreadPosition(event)).toEqual({ rootId: 'a', parentId: 'a' });
  });

  it('ignores tag order in the marked form', () => {
    const event = note('c', [
      ['e', 'b', '', 'reply'],
      ['e', 'a', '', 'root'],
    ]);

    expect(getThreadPosition(event)).toEqual({ rootId: 'a', parentId: 'b' });
  });

  it('reads the deprecated positional form', () => {
    const event = note('d', [
      ['e', 'a'],
      ['e', 'b'],
      ['e', 'c'],
    ]);

    expect(getThreadPosition(event)).toEqual({ rootId: 'a', parentId: 'c' });
  });

  it('treats a single positional tag as both root and parent', () => {
    expect(getThreadPosition(note('b', [['e', 'a']]))).toEqual({
      rootId: 'a',
      parentId: 'a',
    });
  });

  it('does not mistake a pubkey in the marker slot for a marker', () => {
    // Clients have written ["e", id, relay, pubkey], which is not NIP-10 —
    // falling back to the positional reading is what keeps those threads intact
    const event = note('b', [['e', 'a', '', 'f'.repeat(64)]]);

    expect(getThreadPosition(event)).toEqual({ rootId: 'a', parentId: 'a' });
  });

  it('skips `e` tags with no value', () => {
    expect(getThreadPosition(note('b', [['e', '']]))).toEqual({
      rootId: null,
      parentId: null,
    });
  });

  it('identifies replies', () => {
    expect(isReply(note('a'))).toBe(false);
    expect(isReply(note('b', [['e', 'a']]))).toBe(true);
  });
});

describe('buildReplyTags', () => {
  it('makes the parent the root when replying to a top-level note', () => {
    const tags = buildReplyTags(note('a'));

    expect(tags).toEqual([
      ['e', 'a', '', 'root'],
      ['p', 'pubkey-a'],
    ]);
  });

  it('carries the root forward when replying to a reply', () => {
    const parent = note('b', [['e', 'a', '', 'root']]);
    const tags = buildReplyTags(parent);

    expect(tags).toContainEqual(['e', 'a', '', 'root']);
    expect(tags).toContainEqual(['e', 'b', '', 'reply', 'pubkey-b']);
  });

  it('keeps every participant in the conversation notified', () => {
    const parent = note('b', [
      ['e', 'a', '', 'root'],
      ['p', 'alice'],
      ['p', 'bob'],
    ]);

    const mentioned = buildReplyTags(parent)
      .filter(([name]) => name === 'p')
      .map(([, value]) => value);

    expect(mentioned).toEqual(['pubkey-b', 'alice', 'bob']);
  });

  it('does not mention the same person twice', () => {
    const parent = note('b', [
      ['e', 'a', '', 'root'],
      ['p', 'pubkey-b'],
    ]);

    const mentioned = buildReplyTags(parent).filter(([name]) => name === 'p');

    expect(mentioned).toEqual([['p', 'pubkey-b']]);
  });
});

describe('buildReplyTree', () => {
  const root = note('root');
  const a = note('a', [['e', 'root', '', 'root']], { created_at: 100 });
  const b = note('b', [['e', 'root', '', 'root']], { created_at: 200 });
  const a1 = note('a1', [
    ['e', 'root', '', 'root'],
    ['e', 'a', '', 'reply'],
  ]);

  it('nests replies under the note they answer', () => {
    const tree = buildReplyTree([a, b, a1], root.id);

    expect(tree.map((node) => node.event.id)).toEqual(['a', 'b']);
    expect(tree[0].children.map((node) => node.event.id)).toEqual(['a1']);
  });

  it('orders siblings oldest first', () => {
    const tree = buildReplyTree([b, a], root.id);

    expect(tree.map((node) => node.event.id)).toEqual(['a', 'b']);
  });

  it('records depth relative to the root', () => {
    const tree = buildReplyTree([a, a1], root.id);

    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].depth).toBe(1);
  });

  it('excludes the root itself', () => {
    const tree = buildReplyTree([root, a], root.id);

    expect(tree.map((node) => node.event.id)).toEqual(['a']);
  });

  it('collapses duplicates delivered by more than one relay', () => {
    const tree = buildReplyTree([a, { ...a }], root.id);

    expect(tree).toHaveLength(1);
  });

  it('surfaces a reply whose parent never arrived rather than dropping it', () => {
    const orphan = note('orphan', [
      ['e', 'root', '', 'root'],
      ['e', 'missing', '', 'reply'],
    ]);

    const tree = buildReplyTree([orphan], root.id);

    expect(tree.map((node) => node.event.id)).toEqual(['orphan']);
  });

  it('does not hang on a reply that tags itself', () => {
    const looped = note('loop', [
      ['e', 'root', '', 'root'],
      ['e', 'loop', '', 'reply'],
    ]);

    const tree = buildReplyTree([looped], root.id);

    expect(tree.map((node) => node.event.id)).toEqual(['loop']);
  });

  it('does not hang on two replies that name each other as parent', () => {
    const x = note('x', [
      ['e', 'root', '', 'root'],
      ['e', 'y', '', 'reply'],
    ]);
    const y = note('y', [
      ['e', 'root', '', 'root'],
      ['e', 'x', '', 'reply'],
    ]);

    const tree = buildReplyTree([x, y], root.id);

    // One of the pair breaks the loop and is shown at the top level
    expect(tree.length).toBeGreaterThan(0);
    expect(countDescendants(tree[0])).toBeLessThan(2);
  });
});

describe('descendantsOf', () => {
  const a = note('a', [['e', 'root', '', 'root']]);
  const a1 = note('a1', [
    ['e', 'root', '', 'root'],
    ['e', 'a', '', 'reply'],
  ]);
  const a2 = note('a2', [
    ['e', 'root', '', 'root'],
    ['e', 'a1', '', 'reply'],
  ]);

  it('returns the replies below the focused note', () => {
    const tree = buildReplyTree([a, a1, a2], 'root');

    expect(descendantsOf(tree, 'a').map((node) => node.event.id)).toEqual([
      'a1',
    ]);
  });

  it('re-bases depth on the focused note', () => {
    const tree = buildReplyTree([a, a1, a2], 'root');
    const focused = descendantsOf(tree, 'a');

    expect(focused[0].depth).toBe(0);
    expect(focused[0].children[0].depth).toBe(1);
  });

  it('returns the whole tree when the root is the focus', () => {
    const tree = buildReplyTree([a, a1], 'root');

    expect(descendantsOf(tree, 'root')).toBe(tree);
  });
});

describe('countDescendants', () => {
  it('counts every reply beneath a node, not just its children', () => {
    const tree = buildReplyTree(
      [
        note('a', [['e', 'root', '', 'root']]),
        note('a1', [
          ['e', 'root', '', 'root'],
          ['e', 'a', '', 'reply'],
        ]),
        note('a2', [
          ['e', 'root', '', 'root'],
          ['e', 'a1', '', 'reply'],
        ]),
      ],
      'root'
    );

    expect(countDescendants(tree[0])).toBe(2);
  });
});
