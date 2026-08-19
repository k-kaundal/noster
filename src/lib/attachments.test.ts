import { describe, it, expect } from 'vitest';

import {
  MAX_IMAGES,
  extractHashtags,
  hashtagTags,
  imageMimeType,
  imageProblem,
  imetaTags,
  withAttachments,
} from './attachments';

/** A stand-in for a picked file, since jsdom has no real ones. */
function file(type: string, bytes = 1024): File {
  return {
    type,
    size: bytes,
    name: 'photo',
  } as File;
}

describe('extractHashtags', () => {
  it('reads tags as relays index them', () => {
    expect(extractHashtags('hello #nostr and #bitcoin')).toEqual([
      'nostr',
      'bitcoin',
    ]);
  });

  it('lowercases, because a `t` filter is exact', () => {
    // `#Bitcoin` and `#bitcoin` are one subject to a reader and two to a relay
    expect(extractHashtags('#Bitcoin #BITCOIN')).toEqual(['bitcoin']);
  });

  it('ignores the fragment on a link', () => {
    /*
     * A URL is the one place a `#` routinely means something else, and filing
     * a post under "install" because it linked to a docs anchor is a tag its
     * author never chose.
     */
    expect(extractHashtags('see example.com/docs#install')).toEqual([]);
  });

  it('reads a tag that opens the text', () => {
    expect(extractHashtags('#opening line')).toEqual(['opening']);
  });

  it('keeps letters beyond ascii', () => {
    expect(extractHashtags('#café #日本')).toEqual(['café', '日本']);
  });

  it('finds nothing in text with no tags', () => {
    expect(extractHashtags('just words')).toEqual([]);
  });
});

describe('hashtagTags', () => {
  it('emits one indexed tag per subject', () => {
    expect(hashtagTags('#a #b')).toEqual([
      ['t', 'a'],
      ['t', 'b'],
    ]);
  });
});

describe('imageMimeType', () => {
  it('reads the extension', () => {
    expect(imageMimeType('https://x/y.png')).toBe('image/png');
    expect(imageMimeType('https://x/y.WEBP')).toBe('image/webp');
  });

  it('guesses jpeg for anything it does not know', () => {
    // `imeta` is a hint for laying a picture out, so a wrong guess costs a
    // layout choice rather than a broken note
    expect(imageMimeType('https://x/y')).toBe('image/jpeg');
  });
});

describe('imetaTags', () => {
  it('describes each picture', () => {
    expect(imetaTags(['https://x/y.png'])).toEqual([
      ['imeta', 'url https://x/y.png', 'm image/png'],
    ]);
  });

  it('emits nothing for a note with no pictures', () => {
    expect(imetaTags([])).toEqual([]);
  });
});

describe('imageProblem', () => {
  it('accepts an ordinary image', () => {
    expect(imageProblem(file('image/png'), 0)).toBeNull();
  });

  it('refuses a file that is not an image', () => {
    expect(imageProblem(file('application/pdf'), 0)).toMatch(/not an image/i);
  });

  it('refuses one too large to upload', () => {
    expect(imageProblem(file('image/png', 20 * 1024 * 1024), 0)).toMatch(/MB/);
  });

  it('refuses one past the limit', () => {
    expect(imageProblem(file('image/png'), MAX_IMAGES)).toMatch(/up to/i);
  });
});

describe('withAttachments', () => {
  it('puts the pictures in the body where clients look for them', () => {
    /*
     * `imeta` describes an image, it does not place one — a note whose
     * pictures live only in tags reads as text in every other client.
     */
    expect(withAttachments('look', ['https://x/y.png'])).toBe(
      'look\nhttps://x/y.png'
    );
  });

  it('posts a picture with no words', () => {
    expect(withAttachments('   ', ['https://x/y.png'])).toBe(
      'https://x/y.png'
    );
  });

  it('leaves text alone when nothing is attached', () => {
    expect(withAttachments('  just words  ', [])).toBe('just words');
  });
});
