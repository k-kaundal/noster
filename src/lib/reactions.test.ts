import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  buildDeletionTags,
  buildReportTags,
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

describe('buildReportTags', () => {
  it('tags the author with the report type', () => {
    expect(buildReportTags({ pubkey: THEM, type: 'spam' })).toEqual([
      ['p', THEM, 'spam'],
    ]);
  });

  it('tags the note as well when one prompted the report', () => {
    const tags = buildReportTags({
      pubkey: THEM,
      eventId: 'd'.repeat(64),
      kind: 1,
      type: 'nudity',
    });

    expect(tags).toEqual([
      ['p', THEM, 'nudity'],
      ['e', 'd'.repeat(64), 'nudity'],
      ['k', '1'],
    ]);
  });

  it('omits the kind tag when the kind is unknown', () => {
    const tags = buildReportTags({
      pubkey: THEM,
      eventId: 'd'.repeat(64),
      type: 'other',
    });

    expect(tags.some(([name]) => name === 'k')).toBe(false);
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
