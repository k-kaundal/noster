import { describe, it, expect } from 'vitest';
import { MAX_LINES, truncateLines, wrapText } from './shareCard';

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
