import { describe, it, expect } from 'vitest';
import {
  isSafeHref,
  looksLikeMarkdown,
  markdownToText,
  parseInline,
  parseMarkdown,
} from './markdown';

describe('parseMarkdown', () => {
  it('reads headings at each level it supports', () => {
    const blocks = parseMarkdown('# One\n\n## Two\n\n#### Four');

    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'One' },
      { type: 'heading', level: 2, text: 'Two' },
      { type: 'heading', level: 4, text: 'Four' },
    ]);
  });

  it('caps deeper headings rather than dropping them', () => {
    expect(parseMarkdown('###### Six')[0]).toEqual({
      type: 'heading',
      level: 4,
      text: 'Six',
    });
  });

  it('joins wrapped lines into one paragraph', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');

    expect(blocks).toEqual([
      { type: 'paragraph', text: 'one two' },
      { type: 'paragraph', text: 'three' },
    ]);
  });

  it('reads bullet lists', () => {
    expect(parseMarkdown('- a\n- b\n* c')).toEqual([
      { type: 'list', ordered: false, items: ['a', 'b', 'c'] },
    ]);
  });

  it('reads numbered lists', () => {
    expect(parseMarkdown('1. a\n2. b')).toEqual([
      { type: 'list', ordered: true, items: ['a', 'b'] },
    ]);
  });

  it('does not merge a numbered list into a bullet one', () => {
    const blocks = parseMarkdown('- a\n1. b');

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ ordered: false });
    expect(blocks[1]).toMatchObject({ ordered: true });
  });

  it('joins consecutive quote lines', () => {
    expect(parseMarkdown('> a\n> b')).toEqual([
      { type: 'quote', text: 'a b' },
    ]);
  });

  it('keeps code fences verbatim, including blank lines', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1;\n\nconst b = 2;\n```');

    expect(blocks).toEqual([
      { type: 'code', language: 'ts', text: 'const a = 1;\n\nconst b = 2;' },
    ]);
  });

  it('does not treat markdown inside a fence as markdown', () => {
    const blocks = parseMarkdown('```\n# not a heading\n- not a list\n```');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'code' });
  });

  it('runs an unclosed fence to the end instead of losing the rest', () => {
    const blocks = parseMarkdown('```\nstill code');

    expect(blocks).toEqual([
      { type: 'code', language: undefined, text: 'still code' },
    ]);
  });

  it('reads a standalone image as its own block', () => {
    expect(parseMarkdown('![a cat](https://x/cat.png)')).toEqual([
      { type: 'image', alt: 'a cat', url: 'https://x/cat.png' },
    ]);
  });

  it('reads horizontal rules', () => {
    expect(parseMarkdown('---')).toEqual([{ type: 'rule' }]);
  });

  it('returns nothing for an empty document', () => {
    expect(parseMarkdown('   \n\n  ')).toEqual([]);
  });
});

describe('parseInline', () => {
  it('reads bold, italic and code', () => {
    expect(parseInline('a **b** c *d* e `f`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', text: 'b' },
      { type: 'text', text: ' c ' },
      { type: 'italic', text: 'd' },
      { type: 'text', text: ' e ' },
      { type: 'code', text: 'f' },
    ]);
  });

  it('reads underscore emphasis too', () => {
    expect(parseInline('__b__ _i_')).toEqual([
      { type: 'bold', text: 'b' },
      { type: 'text', text: ' ' },
      { type: 'italic', text: 'i' },
    ]);
  });

  it('reads links', () => {
    expect(parseInline('see [docs](https://example.com) now')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', text: 'docs', href: 'https://example.com' },
      { type: 'text', text: ' now' },
    ]);
  });

  it('leaves ordinary prose alone', () => {
    expect(parseInline('nothing to see')).toEqual([
      { type: 'text', text: 'nothing to see' },
    ]);
  });

  it('does not hang on an unmatched marker', () => {
    expect(parseInline('a * b')).toEqual([{ type: 'text', text: 'a * b' }]);
  });
});

describe('isSafeHref', () => {
  it('allows the schemes a reader would expect', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('mailto:a@b.com')).toBe(true);
    expect(isSafeHref('nostr:npub1abc')).toBe(true);
    expect(isSafeHref('/local/path')).toBe(true);
  });

  it('refuses javascript: URLs', () => {
    // The one way markdown turns into script execution
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('  JavaScript:alert(1)')).toBe(false);
  });

  it('refuses data: URLs', () => {
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('refuses a scheme it does not recognise', () => {
    expect(isSafeHref('file:///etc/passwd')).toBe(false);
  });
});

describe('markdownToText', () => {
  it('strips formatting for a preview', () => {
    const text = markdownToText('# Title\n\nSome **bold** words.\n\n- one\n- two');

    expect(text).toBe('Title Some bold words. one two');
  });

  it('leaves out images and rules, which read as nothing', () => {
    expect(markdownToText('![alt](https://x/y.png)\n\n---\n\nreal text')).toBe(
      'real text'
    );
  });
});

describe('looksLikeMarkdown', () => {
  it('spots the unambiguous signals on their own', () => {
    expect(
      looksLikeMarkdown('```js\nconst a = 1;\n```\nThat is the whole example here.')
    ).toBe(true);
    expect(
      looksLikeMarkdown(
        'Read this: [the article](https://example.com/a) — worth your time today.'
      )
    ).toBe(true);
  });

  it('needs two weaker signals to agree', () => {
    // One emphasis alone is not enough
    expect(
      looksLikeMarkdown(
        'He said "wait" and then _left_ — one emphasis alone is not markdown.'
      )
    ).toBe(false);

    expect(
      looksLikeMarkdown(
        '# My title\n\nSome text here that goes on a while with **bold** in it.'
      )
    ).toBe(true);
  });

  it('does not mistake a hashtag for a heading', () => {
    expect(
      looksLikeMarkdown(
        'Check out #bitcoin and #nostr — both are pretty interesting right now.'
      )
    ).toBe(false);
  });

  it('does not mistake dashes in prose for a list', () => {
    expect(
      looksLikeMarkdown(
        'Prices: 100 - 200 sats\nDelivery - next week\nContact - dm me anytime'
      )
    ).toBe(false);

    expect(
      looksLikeMarkdown(
        '- just one dash starting this line, nothing else markdown-ish here'
      )
    ).toBe(false);
  });

  it('does not fire on an ordinary note', () => {
    expect(
      looksLikeMarkdown(
        'gm nostr, hope everyone is having a great morning out there today'
      )
    ).toBe(false);
    expect(
      looksLikeMarkdown('I paid 5 * 3 = 15 sats for it, which felt fair enough')
    ).toBe(false);
  });

  it('ignores anything too short to be an article', () => {
    expect(looksLikeMarkdown('# hi')).toBe(false);
  });
});
