import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { shareableNote } from './shareNote';

function note(content: string, tags: string[][] = []): NostrEvent {
  return {
    id: '0'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 0,
    kind: 1,
    tags,
    content,
    sig: '',
  };
}

describe('shareableNote', () => {
  it('finds the picture a note published in an imeta tag', () => {
    const event = note('look at this', [
      ['imeta', 'url https://cdn.example/a.jpg', 'm image/jpeg'],
    ]);

    expect(shareableNote(event)).toEqual({
      text: 'look at this',
      imageUrl: 'https://cdn.example/a.jpg',
    });
  });

  it('finds a picture posted as a bare url, and takes it out of the text', () => {
    /**
     * How most notes carry an image. Leaving the URL in means the card shows
     * the picture and the address of the picture, which reads as a mistake.
     */
    expect(shareableNote(note('look at this https://cdn.example/a.png'))).toEqual(
      { text: 'look at this', imageUrl: 'https://cdn.example/a.png' }
    );
  });

  it('keeps links that are not pictures', () => {
    // A note whose point is the article it links to says nothing without it
    const event = note('good read https://example.com/article');

    expect(shareableNote(event)).toEqual({
      text: 'good read https://example.com/article',
      imageUrl: undefined,
    });
  });

  it('takes out every picture url, not only the one it draws', () => {
    const event = note(
      'three https://cdn.example/a.jpg https://cdn.example/b.jpg'
    );

    expect(shareableNote(event).text).toBe('three');
    expect(shareableNote(event).imageUrl).toBe('https://cdn.example/a.jpg');
  });

  it('prefers the imeta url over one found in the text', () => {
    // The tag is the author's own statement about which picture is theirs
    const event = note('x https://cdn.example/text.jpg', [
      ['imeta', 'url https://cdn.example/tagged.jpg'],
    ]);

    expect(shareableNote(event).imageUrl).toBe('https://cdn.example/tagged.jpg');
  });

  it('collapses the blank lines a removed url leaves', () => {
    const event = note('before\n\nhttps://cdn.example/a.jpg\n\nafter');

    expect(shareableNote(event).text).toBe('before\n\nafter');
  });

  it('handles a note that is nothing but a picture', () => {
    expect(shareableNote(note('https://cdn.example/a.webp'))).toEqual({
      text: '',
      imageUrl: 'https://cdn.example/a.webp',
    });
  });

  it('ignores an imeta tag naming something that is not an image', () => {
    const event = note('clip', [['imeta', 'url https://cdn.example/a.mp4']]);

    expect(shareableNote(event).imageUrl).toBeUndefined();
  });
});
