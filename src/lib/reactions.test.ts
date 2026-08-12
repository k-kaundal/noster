import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  buildDeletionTags,
  buildReactionTags,
  buildUnreactTags,
  customEmojiUrl,
  groupReactions,
  isLike,
  reactionEmoji,
} from './reactions';

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);

function reaction(
  content: string,
  pubkey = THEM,
  tags: string[][] = []
): NostrEvent {
  return {
    id: `${content}-${pubkey}`.padEnd(64, '0').slice(0, 64),
    pubkey,
    created_at: 1_700_000_000,
    kind: 7,
    tags,
    content,
    sig: 'c'.repeat(128),
  };
}

describe('reactionEmoji', () => {
  it('renders both spellings of "like" as a heart', () => {
    expect(reactionEmoji(reaction('+'))).toBe('❤️');
    expect(reactionEmoji(reaction(''))).toBe('❤️');
    expect(reactionEmoji(reaction('  '))).toBe('❤️');
  });

  it('renders a dislike', () => {
    expect(reactionEmoji(reaction('-'))).toBe('👎');
  });

  it('passes any other emoji through', () => {
    expect(reactionEmoji(reaction('🔥'))).toBe('🔥');
  });
});

describe('customEmojiUrl', () => {
  it('resolves a shortcode against the event tags', () => {
    const event = reaction(':pepe:', THEM, [
      ['emoji', 'pepe', 'https://example.com/pepe.png'],
    ]);
    expect(customEmojiUrl(event)).toBe('https://example.com/pepe.png');
  });

  it('returns null when the shortcode has no matching tag', () => {
    expect(customEmojiUrl(reaction(':pepe:'))).toBeNull();
  });

  it('returns null for a plain emoji', () => {
    expect(customEmojiUrl(reaction('🔥'))).toBeNull();
  });
});

describe('isLike', () => {
  it('accepts "+" and empty, rejects everything else', () => {
    expect(isLike(reaction('+'))).toBe(true);
    expect(isLike(reaction(''))).toBe(true);
    expect(isLike(reaction('🔥'))).toBe(false);
    expect(isLike(reaction('-'))).toBe(false);
  });
});

describe('groupReactions', () => {
  it('collapses "+" and "❤️" into one count rather than two', () => {
    const groups = groupReactions([
      reaction('+', THEM),
      reaction('❤️', ME),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('orders groups by how many people used them', () => {
    const groups = groupReactions([
      reaction('🔥', ME),
      reaction('😂', THEM),
      reaction('🔥', 'c'.repeat(64)),
    ]);

    expect(groups.map((group) => group.emoji)).toEqual(['🔥', '😂']);
    expect(groups[0].count).toBe(2);
  });

  it('marks the signed-in user and remembers their reaction id', () => {
    const mine = reaction('🔥', ME);
    const groups = groupReactions([mine, reaction('🔥', THEM)], ME);

    expect(groups[0].reacted).toBe(true);
    expect(groups[0].ownReactionId).toBe(mine.id);
  });

  it('leaves reacted false when the user has not reacted', () => {
    expect(groupReactions([reaction('🔥', THEM)], ME)[0].reacted).toBe(false);
  });

  it('counts a person once when a relay serves their reaction twice', () => {
    const duplicate = reaction('🔥', THEM);
    expect(groupReactions([duplicate, duplicate])[0].count).toBe(1);
  });

  it('carries the custom emoji image onto the group', () => {
    const event = reaction(':pepe:', THEM, [
      ['emoji', 'pepe', 'https://example.com/pepe.png'],
    ]);
    expect(groupReactions([event])[0].url).toBe('https://example.com/pepe.png');
  });
});

describe('buildDeletionTags', () => {
  it('references each event and its kind', () => {
    const tags = buildDeletionTags([reaction('+'), { ...reaction('🔥'), kind: 1 }]);

    expect(tags.filter(([name]) => name === 'e')).toHaveLength(2);
    expect(tags).toContainEqual(['k', '7']);
    expect(tags).toContainEqual(['k', '1']);
  });

  it('lists each kind once however many events share it', () => {
    const tags = buildDeletionTags([
      reaction('+', ME),
      reaction('🔥', THEM),
    ]);

    expect(tags.filter(([name]) => name === 'k')).toEqual([['k', '7']]);
  });

  it('returns nothing to delete for an empty list', () => {
    expect(buildDeletionTags([])).toEqual([]);
  });
});

describe('buildReactionTags', () => {
  const note: NostrEvent = {
    id: 'n'.repeat(64),
    pubkey: THEM,
    kind: 1,
    content: 'hello',
    tags: [],
    created_at: 0,
    sig: '',
  };

  const article: NostrEvent = { ...note, kind: 30023, tags: [['d', 'my-post']] };

  it('puts the target author in the fourth position of the e tag', () => {
    // Not a NIP-10 marker: this used to say "root", so every reaction the app
    // sent named a person called root as the author of what it reacted to
    expect(buildReactionTags(note, { relay: 'wss://r' })).toContainEqual([
      'e',
      'n'.repeat(64),
      'wss://r',
      THEM,
    ]);
  });

  it('tags the author and the kind', () => {
    const tags = buildReactionTags(note, { relay: 'wss://r' });

    expect(tags).toContainEqual(['p', THEM, 'wss://r']);
    expect(tags).toContainEqual(['k', '1']);
  });

  it('adds an address alongside the id for an addressable target', () => {
    // The id changes every time the author fixes a typo; the address does not
    const tags = buildReactionTags(article);

    expect(tags).toContainEqual(['a', `30023:${THEM}:my-post`]);
    expect(tags.some(([name]) => name === 'e')).toBe(true);
  });

  it('gives a regular event no address, because it has none', () => {
    expect(buildReactionTags(note).some(([name]) => name === 'a')).toBe(false);
  });

  it('keeps the id last among e tags and the author last among p tags', () => {
    const tags = buildReactionTags(article);

    const lastE = [...tags].reverse().find(([name]) => name === 'e');
    const lastP = [...tags].reverse().find(([name]) => name === 'p');

    expect(lastE?.[1]).toBe('n'.repeat(64));
    expect(lastP?.[1]).toBe(THEM);
  });

  it('carries a NIP-30 custom emoji', () => {
    const tags = buildReactionTags(note, {
      emoji: { shortcode: 'soapbox', url: 'https://example.com/s.png' },
    });

    expect(tags).toContainEqual([
      'emoji',
      'soapbox',
      'https://example.com/s.png',
    ]);
  });

  it('does not pad tags with an empty relay hint it does not have', () => {
    for (const tag of buildReactionTags(note)) {
      expect(tag[tag.length - 1]).not.toBe('');
    }
  });

  it('still writes the author when there is no hint to go before it', () => {
    // Positional tags: dropping the empty hint would move the pubkey into the
    // hint's slot and claim a relay named after a person
    expect(buildReactionTags(note)).toContainEqual([
      'e',
      'n'.repeat(64),
      '',
      THEM,
    ]);
  });
});

describe('buildUnreactTags', () => {
  it('names the reaction and its kind', () => {
    // The kind lets a relay honour the request without looking the event up,
    // including one that has already dropped it
    expect(buildUnreactTags('r'.repeat(64))).toEqual([
      ['e', 'r'.repeat(64)],
      ['k', '7'],
    ]);
  });
});
