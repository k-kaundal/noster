import { describe, it, expect } from 'vitest';
import { cardFor, filterFor, injectCard } from './preview';

/** The article whose blank preview started this. */
const SHARED_ARTICLE =
  'naddr1qvzqqqr4gupzpu0wsxacgde3expl4kv8sn07np80m59s277tkh50zml5f9u8uk0kqpqxc6t8dp6xu6twvukkuet5wahhy6edd9hz6v3sxgmz6cnfw33k76tw94cxz7tdv4h8guedv9ex2ttzv43k7mtfdenj66tww3jhymn9wsm534ta';

function event(over: Partial<Parameters<typeof cardFor>[0]> = {}) {
  return {
    id: 'a'.repeat(64),
    kind: 1,
    pubkey: 'b'.repeat(64),
    created_at: 1000,
    content: '',
    tags: [] as string[][],
    sig: '',
    ...over,
  };
}

describe('filterFor', () => {
  it('finds the article somebody actually shared', () => {
    /*
     * Decoded independently by nostr-tools as kind 30023 by f1ee81bb…, with
     * the `d` tag below. This is the whole reason the bech32 reader exists, so
     * it is checked against a real identifier rather than one made up here.
     */
    expect(filterFor(SHARED_ARTICLE)).toEqual({
      kinds: [30023],
      authors: ['f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6'],
      '#d': ['lightning-network-in-2026-bitcoin-payments-are-becoming-internet'],
    });
  });

  it('asks for the profile behind an npub', () => {
    const filter = filterFor(
      'npub178hgrwuyxucunql6mxrcfhlfsnha6zc9009mt683dl6yj7r7t8mq7zq9kz'
    );

    expect(filter).toEqual({
      kinds: [0],
      authors: ['f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6'],
    });
  });

  it('reads an identifier however it was cased', () => {
    expect(filterFor(SHARED_ARTICLE.toUpperCase())).toEqual(
      filterFor(SHARED_ARTICLE)
    );
  });

  it('declines anything that is not a NIP-19 identifier', () => {
    expect(filterFor('docs')).toBeNull();
    expect(filterFor('')).toBeNull();
    expect(filterFor('npub1')).toBeNull();
    expect(filterFor('@alice')).toBeNull();
    // Valid bech32, a prefix this does not serve
    expect(filterFor('nsec1qqqqqqqqqqqqqq')).toBeNull();
  });

  it('declines a truncated identifier rather than guessing', () => {
    expect(filterFor('npub178hgrwuyxucunql6mxrcfhlfsnha')).toBeNull();
  });
});

describe('cardFor', () => {
  it('uses an article title, summary and cover', () => {
    const card = cardFor(
      event({
        kind: 30023,
        content: 'The body, which should not be used when there is a summary.',
        tags: [
          ['d', 'slug'],
          ['title', 'Lightning in 2026'],
          ['summary', 'Where payments are going.'],
          ['image', 'https://example.com/cover.png'],
        ],
      })
    );

    expect(card).toEqual({
      title: 'Lightning in 2026',
      description: 'Where payments are going.',
      image: 'https://example.com/cover.png',
    });
  });

  it('falls back to an article body when it carries no summary', () => {
    const card = cardFor(
      event({
        kind: 30023,
        content: 'A long piece about the lightning network.',
        tags: [['title', 'Lightning']],
      })
    );

    expect(card?.description).toBe('A long piece about the lightning network.');
  });

  it('names the author of a note', () => {
    const card = cardFor(
      event({ content: 'Just shipped something.' }),
      event({ kind: 0, content: JSON.stringify({ display_name: 'Alice' }) })
    );

    expect(card?.title).toBe('Alice on NostrFeed');
    expect(card?.description).toBe('Just shipped something.');
  });

  it('still describes a note when the author is unknown', () => {
    // A profile lookup that failed must not lose the note's own text
    const card = cardFor(event({ content: 'Just shipped something.' }));

    expect(card?.title).toBe('Note on NostrFeed');
    expect(card?.description).toBe('Just shipped something.');
  });

  it('describes a profile from its own metadata', () => {
    const card = cardFor(
      event({
        kind: 0,
        content: JSON.stringify({
          name: 'alice',
          about: 'Building things.',
          picture: 'https://example.com/a.png',
        }),
      })
    );

    expect(card).toEqual({
      title: 'alice on NostrFeed',
      description: 'Building things.',
      image: 'https://example.com/a.png',
    });
  });

  it('declines an empty note rather than showing a blank card', () => {
    expect(cardFor(event({ content: '   ' }))).toBeNull();
  });

  it('declines a profile with nothing in it', () => {
    expect(cardFor(event({ kind: 0, content: '{}' }))).toBeNull();
  });

  it('survives content that is not the JSON it should be', () => {
    expect(cardFor(event({ kind: 0, content: 'not json' }))).toBeNull();
    expect(
      cardFor(event({ content: 'a note' }), event({ kind: 0, content: '<html>' }))
    ).not.toBeNull();
  });

  it('collapses whitespace and trims to a length a card will show', () => {
    const card = cardFor(event({ content: `${'word '.repeat(200)}` }));

    expect(card!.description.length).toBeLessThanOrEqual(200);
    expect(card!.description).not.toContain('\n');
    expect(card!.description.endsWith('…')).toBe(true);
  });
});

describe('injectCard', () => {
  const html = [
    '<!doctype html><html><head>',
    '<title>NostrFeed</title>',
    '<meta property="og:title" content="NostrFeed">',
    '<meta property="og:description" content="The front door.">',
    '<meta property="og:image" content="https://www.nostrfeed.com/og-image.png">',
    '<meta name="twitter:card" content="summary">',
    '</head><body><div id="root"></div></body></html>',
  ].join('');

  const card = {
    title: 'Lightning in 2026',
    description: 'Where payments are going.',
    image: 'https://example.com/cover.png',
  };

  const url = 'https://www.nostrfeed.com/naddr1abc';

  it('replaces the title', () => {
    expect(injectCard(html, card, url)).toContain(
      '<title>Lightning in 2026</title>'
    );
  });

  it('leaves exactly one of each tag', () => {
    /*
     * Two `og:title` tags is not "the more specific one wins" — it is
     * undefined, and several fetchers take the first, which is the generic one
     * being replaced.
     */
    const out = injectCard(html, card, url);

    expect(out.match(/property="og:title"/g)).toHaveLength(1);
    expect(out.match(/property="og:description"/g)).toHaveLength(1);
    expect(out.match(/property="og:image"/g)).toHaveLength(1);
    expect(out.match(/name="twitter:card"/g)).toHaveLength(1);
  });

  it('drops the front door image rather than keeping it alongside', () => {
    expect(injectCard(html, card, url)).not.toContain('og-image.png');
  });

  it('names the url it was served for', () => {
    expect(injectCard(html, card, url)).toContain(
      `<meta property="og:url" content="${url}">`
    );
  });

  it('asks for a large image only when there is one', () => {
    expect(injectCard(html, card, url)).toContain(
      'content="summary_large_image"'
    );

    const { image: _image, ...noImage } = card;
    const out = injectCard(html, noImage, url);

    expect(out).toContain('name="twitter:card" content="summary"');
    expect(out).not.toContain('og:image');
  });

  it('escapes a title that would otherwise close the tag', () => {
    // Content comes from a relay, which means it comes from anybody
    const out = injectCard(
      html,
      { title: '"><script>alert(1)</script>', description: 'x' },
      url
    );

    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('leaves the app itself intact', () => {
    // The page still has to boot for the person who clicked the link
    expect(injectCard(html, card, url)).toContain('<div id="root"></div>');
  });
});
