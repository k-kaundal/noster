import { describe, it, expect } from 'vitest';
import {
  insertBlock,
  insertLink,
  toggleOrderedList,
  togglePrefix,
  toggleWrap,
  wordCount,
} from './markdownEdit';

/**
 * `hello |world|` marks a selection; a single `|` marks a bare caret.
 *
 * Pipes rather than offsets, because an off-by-one in a test fixture is
 * indistinguishable from an off-by-one in the code it is testing.
 */
function at(marked: string) {
  const start = marked.indexOf('|');
  const last = marked.lastIndexOf('|');

  return {
    value: marked.replace(/\|/g, ''),
    start,
    end: last === start ? start : last - 1,
  };
}

function show({ value, start, end }: { value: string; start: number; end: number }) {
  return `${value.slice(0, start)}|${value.slice(start, end)}|${value.slice(end)}`;
}

describe('toggleWrap', () => {
  it('wraps the selection', () => {
    expect(show(toggleWrap(at('hello |world|'), '**'))).toBe(
      'hello **|world|**'
    );
  });

  it('unwraps when the markers are inside the selection', () => {
    // Pressing bold twice has to undo it, or a mistaken keystroke is a
    // cleanup job rather than a keystroke
    expect(show(toggleWrap(at('hello |**world**|'), '**'))).toBe(
      'hello |world|'
    );
  });

  it('unwraps when the markers are just outside the selection', () => {
    // What you get by double-clicking the word inside existing asterisks
    expect(show(toggleWrap(at('hello **|world|**'), '**'))).toBe(
      'hello |world|'
    );
  });

  it('inserts a selected placeholder when nothing is selected', () => {
    // Left selected so the next keystroke replaces it instead of landing
    // between the markers
    expect(show(toggleWrap(at('hello ||'), '*'))).toBe('hello *|text|*');
  });
});

describe('togglePrefix', () => {
  it('prefixes the line the caret is on', () => {
    expect(togglePrefix(at('hel|lo'), '## ').value).toBe('## hello');
  });

  it('prefixes every line the selection touches', () => {
    const state = at('|one\ntwo\nthree|');
    expect(togglePrefix(state, '> ').value).toBe('> one\n> two\n> three');
  });

  it('removes the prefix when every line already has it', () => {
    const state = at('|> one\n> two|');
    expect(togglePrefix(state, '> ').value).toBe('one\ntwo');
  });

  it('adds it to the rest when only some lines have it', () => {
    const state = at('|- one\ntwo|');
    expect(togglePrefix(state, '- ').value).toBe('- - one\n- two');
  });

  it('works from a caret in the middle of a block', () => {
    const state = at('one\ntw|o\nthree');
    expect(togglePrefix(state, '> ').value).toBe('one\n> two\nthree');
  });

  it('leaves a caret, not a selection, when nothing was selected', () => {
    // Selecting the line back means the next character typed replaces it —
    // press Heading, type, and the `## ` you just added is gone
    const result = togglePrefix(at('|'), '## ');

    expect(result.value).toBe('## ');
    expect(result.start).toBe(3);
    expect(result.end).toBe(3);
  });

  it('moves the caret with the text it sits after', () => {
    const result = togglePrefix(at('hel|lo'), '> ');

    expect(result.value).toBe('> hello');
    expect(result.start).toBe(5);
    expect(result.end).toBe(5);
  });

  it('keeps the block selected when a block was selected', () => {
    const result = togglePrefix(at('|one\ntwo|'), '> ');
    expect(result.start).not.toBe(result.end);
  });
});

describe('toggleOrderedList', () => {
  it('numbers the selected lines', () => {
    expect(toggleOrderedList(at('|one\ntwo|')).value).toBe('1. one\n2. two');
  });

  it('unnumbers them again', () => {
    expect(toggleOrderedList(at('|1. one\n2. two|')).value).toBe('one\ntwo');
  });
});

describe('insertLink', () => {
  it('makes the selection the label and selects the target to type', () => {
    expect(show(insertLink(at('see |the docs|')))).toBe(
      'see [the docs](|https://|)'
    );
  });

  it('makes a selected URL the target and selects the label instead', () => {
    // Pasting a URL then pressing link should not make you retype the URL
    expect(show(insertLink(at('|https://example.com|')))).toBe(
      '[|text|](https://example.com)'
    );
  });

  it('handles an empty selection', () => {
    expect(insertLink(at('||')).value).toBe('[text](https://)');
  });
});

describe('insertBlock', () => {
  it('separates the block from the paragraph above it', () => {
    // Without the blank line, Markdown reads the rule as part of the sentence
    expect(insertBlock(at('a sentence|'), '---').value).toBe(
      'a sentence\n\n---\n\n'
    );
  });

  it('does not add blank lines that are already there', () => {
    expect(insertBlock(at('a sentence\n\n|'), '---').value).toBe(
      'a sentence\n\n---\n\n'
    );
  });

  it('inserts into an empty document without leading blanks', () => {
    expect(insertBlock(at('||'), '```\ncode\n```').value).toBe(
      '```\ncode\n```\n\n'
    );
  });

  it('leaves the caret past the gap, ready to keep typing', () => {
    // Landing hard against the block meant the next word joined it: a divider
    // inserted at the end and typed after became `---Some text`
    const result = insertBlock(at('||'), '---');

    expect(result.value).toBe('---\n\n');
    expect(result.start).toBe(5);
    expect(result.end).toBe(5);
  });

  it('does not double a gap that already follows', () => {
    expect(insertBlock(at('|\n\nnext'), '---').value).toBe('---\n\nnext');
  });
});

describe('wordCount', () => {
  it('counts words, not characters', () => {
    expect(wordCount('one two three')).toBe(3);
  });

  it('is zero for nothing and for whitespace', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   \n  ')).toBe(0);
  });

  it('does not count repeated spaces as words', () => {
    expect(wordCount('one    two')).toBe(2);
  });
});
