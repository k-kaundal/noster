import { describe, it, expect } from 'vitest';
import {
  MAX_LINES,
  compactCount,
  describeStats,
  fitText,
  truncateLines,
  wrapText,
} from './shareCard';

/**
 * A stand-in for canvas text measurement.
 *
 * Every character is one unit wide, so a "width" in these tests is a character
 * count and the expected wrapping can be read off by eye. The real measurement
 * is proportional, but the wrapping decisions are the same shape.
 */
const monospace = (text: string) => text.length;

describe('wrapText', () => {
  it('breaks on spaces at the width', () => {
    expect(wrapText('one two three four', 9, monospace)).toEqual([
      'one two',
      'three',
      'four',
    ]);
  });

  it('keeps the line breaks the author wrote', () => {
    expect(wrapText('first\nsecond', 40, monospace)).toEqual([
      'first',
      'second',
    ]);
  });

  it('keeps a blank line between paragraphs', () => {
    expect(wrapText('a\n\nb', 40, monospace)).toEqual(['a', '', 'b']);
  });

  it('breaks a word too long to fit rather than overflowing', () => {
    /**
     * The case this exists for. A pasted npub is a single 63-character word,
     * and left whole it runs off the side of the card and out of the picture.
     */
    expect(wrapText('npub1abcdefghij', 5, monospace)).toEqual([
      'npub1',
      'abcde',
      'fghij',
    ]);
  });

  it('breaks a long word that follows normal text', () => {
    expect(wrapText('hi npub1abcdef', 6, monospace)).toEqual([
      'hi',
      'npub1a',
      'bcdef',
    ]);
  });

  it('drops the trailing blank a note ending in a newline leaves', () => {
    // Otherwise it is an unexplained gap above the footer
    expect(wrapText('text\n\n', 40, monospace)).toEqual(['text']);
  });

  it('collapses runs of whitespace inside a line', () => {
    expect(wrapText('a     b', 40, monospace)).toEqual(['a b']);
  });

  it('returns nothing for an empty note', () => {
    expect(wrapText('', 40, monospace)).toEqual([]);
    expect(wrapText('   \n  ', 40, monospace)).toEqual([]);
  });
});

describe('truncateLines', () => {
  it('leaves a short note alone', () => {
    expect(truncateLines(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('keeps exactly the limit without marking it cut', () => {
    const lines = ['a', 'b', 'c'];
    expect(truncateLines(lines, 3)).toEqual(lines);
  });

  it('marks a note that had more to say', () => {
    expect(truncateLines(['a', 'b', 'c', 'd'], 3)).toEqual(['a', 'b', 'c…']);
  });

  it('does not leave punctuation stranded before the ellipsis', () => {
    expect(truncateLines(['one', 'two,', 'three'], 2)).toEqual(['one', 'two…']);
  });

  it('defaults to a length that still reads in a feed', () => {
    const long = Array.from({ length: 40 }, (_, index) => `line ${index}`);
    expect(truncateLines(long)).toHaveLength(MAX_LINES);
  });
});


describe('describeStats', () => {
  it('reads as a sentence of counts', () => {
    expect(
      describeStats({ reactions: 87, replies: 12, reposts: 8, zapSats: 2100 })
    ).toBe('87 likes  ·  12 replies  ·  8 reposts  ·  2.1k sats');
  });

  it('leaves out what a note has none of', () => {
    /**
     * "0 likes" is a fact nobody wanted to publish. A card with one number on
     * it reads better than one advertising three absences.
     */
    expect(describeStats({ reactions: 3, replies: 0, reposts: 0 })).toBe(
      '3 likes'
    );
  });

  it('says nothing at all for a note with no engagement', () => {
    expect(describeStats({})).toBe('');
    expect(describeStats(undefined)).toBe('');
    expect(describeStats({ reactions: 0, zapSats: 0 })).toBe('');
  });

  it('counts one of something in the singular', () => {
    expect(describeStats({ reactions: 1, replies: 1, reposts: 1 })).toBe(
      '1 like  ·  1 reply  ·  1 repost'
    );
  });
});

describe('compactCount', () => {
  it('leaves small numbers alone', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
  });

  it('shortens the ones that would crowd a line', () => {
    expect(compactCount(1000)).toBe('1.0k');
    expect(compactCount(2100)).toBe('2.1k');
    expect(compactCount(1_500_000)).toBe('1.5M');
  });
});

describe('fitText', () => {
  const monospace = (text: string) => text.length;

  it('leaves text that already fits', () => {
    expect(fitText('short', 10, monospace)).toBe('short');
  });

  it('cuts to the width, ellipsis included', () => {
    /**
     * The footer bug. A `note1` URL is 63 characters and used to be drawn at
     * full width straight through the right-aligned brand, smearing both.
     */
    const fitted = fitText('nostrfeed.com/note17jsfscncajc7mf', 10, monospace);

    expect(fitted).toHaveLength(10);
    expect(fitted.endsWith('…')).toBe(true);
  });

  it('survives a width too small for anything', () => {
    expect(() => fitText('abcdef', 1, monospace)).not.toThrow();
  });
});
