/**
 * @vitest-environment node
 *
 * Node rather than jsdom: this imports the build script, which imports
 * esbuild, and esbuild refuses to load where `TextEncoder` comes from a
 * different realm than the global `Uint8Array` — which is exactly what jsdom
 * arranges.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { articleRoute, newestArticles, pageHtml, siteJsonLd } from './seo-build.mjs';
import { filterFor } from '../api/preview.ts';
import { siteSchema } from '../src/lib/structuredData.ts';

const TEMPLATE = [
  '<!DOCTYPE html><html><head>',
  '<title>NostrFeed — Decentralized Social Network on Nostr</title>',
  '<meta name="description" content="The front page description." />',
  '<meta name="keywords" content="front, page, words" />',
  '<link rel="canonical" href="https://www.nostrfeed.com/" />',
  '<meta property="og:title" content="t" /><meta property="og:description" content="d" />',
  '<meta property="og:url" content="u" /><meta property="og:image" content="i" />',
  '<meta name="twitter:title" content="t" /><meta name="twitter:description" content="d" />',
  '<meta name="twitter:image" content="i" />',
  '<meta name="robots" content="index, follow" />',
  '</head><body></body></html>',
].join('\n');

function article(over = {}) {
  const { tags: extra = [], ...rest } = over;

  return {
    id: 'a'.repeat(64),
    kind: 30023,
    pubkey: 'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6',
    created_at: 1000,
    content: '',
    tags: [
      ['d', 'my-article'],
      ['title', 'My Article'],
      ...extra,
    ],
    sig: '',
    ...rest,
  };
}

describe('newestArticles', () => {
  it('takes an article that has what a card needs', () => {
    expect(newestArticles([article()])).toHaveLength(1);
  });

  it('keeps the newest revision of one article', () => {
    /*
     * Addressable events are identified by author and `d` tag, and relays
     * disagree about which revision they hold — so the same piece arrives
     * several times with different ids and often different titles.
     */
    const kept = newestArticles([
      article({ id: 'old', created_at: 100 }),
      article({ id: 'new', created_at: 200 }),
      article({ id: 'older', created_at: 50 }),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('new');
  });

  it('keeps two different articles by the same author apart', () => {
    const kept = newestArticles([
      article({ id: 'one', tags: [] }),
      article({
        id: 'two',
        tags: [],
        // A different `d` is a different article, however alike the rest is
      }),
    ]);

    expect(kept).toHaveLength(1);

    const distinct = newestArticles([
      article({ id: 'one' }),
      { ...article({ id: 'two' }), tags: [['d', 'other'], ['title', 'Other']] },
    ]);

    expect(distinct).toHaveLength(2);
  });

  it('skips an article with no title', () => {
    // There is nothing to put on a card, and a card saying nothing is worse
    // than the generic one
    const untitled = { ...article(), tags: [['d', 'x']] };
    expect(newestArticles([untitled])).toEqual([]);
  });

  it('skips an article with no d tag, which has no address', () => {
    const unaddressable = { ...article(), tags: [['title', 'x']] };
    expect(newestArticles([unaddressable])).toEqual([]);
  });

  it('skips anything that is not an article', () => {
    expect(newestArticles([{ ...article(), kind: 1 }])).toEqual([]);
    expect(newestArticles([{ ...article(), kind: 30024 }])).toEqual([]);
  });

  it('survives junk a relay sends', () => {
    expect(newestArticles([null, undefined, {}, 'nope', 42])).toEqual([]);
  });

  it('puts the newest first', () => {
    const kept = newestArticles([
      { ...article(), created_at: 100, tags: [['d', 'a'], ['title', 'A']] },
      { ...article(), created_at: 300, tags: [['d', 'b'], ['title', 'B']] },
      { ...article(), created_at: 200, tags: [['d', 'c'], ['title', 'C']] },
    ]);

    expect(kept.map((event) => event.tags[0][1])).toEqual(['b', 'c', 'a']);
  });
});

describe('articleRoute', () => {
  it('addresses the article by naddr', () => {
    const route = articleRoute(article());
    expect(route.path.startsWith('/naddr1')).toBe(true);
  });

  it('carries the title, summary and cover', () => {
    const route = articleRoute(
      article({
        tags: [
          ['summary', 'What it is about.'],
          ['image', 'https://example.com/cover.png'],
        ],
        created_at: 1700000000,
      })
    );

    expect(route.title).toBe('My Article');
    expect(route.description).toBe('What it is about.');
    expect(route.image).toBe('https://example.com/cover.png');
    expect(route.lastmod).toBe('2023-11-14');
  });

  it('falls back to the body when there is no summary', () => {
    const route = articleRoute(article({ content: 'The opening paragraph.' }));
    expect(route.description).toBe('The opening paragraph.');
  });

  it('flattens and trims a long body', () => {
    const route = articleRoute(article({ content: `word\n\n`.repeat(200) }));

    expect(route.description.length).toBeLessThanOrEqual(200);
    expect(route.description).not.toContain('\n');
  });

  it('leaves the image unset rather than using the site card', () => {
    // The page writer falls back for it; a logo where a cover should be says
    // nothing about the article
    expect(articleRoute(article()).image).toBeUndefined();
  });
});

describe('pageHtml', () => {
  const route = {
    path: '/example',
    title: 'Example',
    description: 'What the example page is.',
  };

  it('replaces the front page keywords with the route’s own', () => {
    const html = pageHtml(TEMPLATE, { ...route, keywords: ['nostr reels'] });

    expect(html).toContain('<meta name="keywords" content="nostr reels"');
    expect(html).not.toContain('front, page, words');
  });

  it('strips the front page keywords from a route that has none', () => {
    /*
     * The template is the front page, so its tag has to come out: left in,
     * every page without its own list would claim the front page's words —
     * `/wallet` describing itself as "nostr client" is the case that bit.
     */
    const html = pageHtml(TEMPLATE, route);

    expect(html).not.toContain('name="keywords"');
  });

  it('bakes the site JSON-LD in exactly once', () => {
    const html = pageHtml(TEMPLATE, route);

    expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(html).toContain('"@type":"WebSite"');
  });

  it('adds the FAQ block to the docs page only', () => {
    expect(pageHtml(TEMPLATE, { ...route, path: '/docs' })).toContain(
      '"@type":"FAQPage"'
    );
    expect(pageHtml(TEMPLATE, route)).not.toContain('"@type":"FAQPage"');
  });

  it('marks a noindex page for crawlers while keeping its card', () => {
    const html = pageHtml(TEMPLATE, { ...route, noindex: true });

    expect(html).toContain('content="noindex, follow"');
    expect(html).toContain('What the example page is.');
  });
});

describe('the baked site schema', () => {
  it('matches what the running app emits', () => {
    /*
     * `siteJsonLd` is a copy of `siteSchema()` — duplicated because the build
     * script cannot import the app — and a copy that drifts is a lie told to
     * one set of readers or the other. They are compared rather than trusted.
     */
    expect(JSON.parse(siteJsonLd())).toEqual(siteSchema());
  });

  it('is the one already in index.html', async () => {
    /*
     * The build bakes the block into `dist/index.html`, whose keywords come
     * from the source `index.html` — the two files saying different things
     * about the same site is the drift this guards.
     */
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const source = await readFile(join(root, 'index.html'), 'utf8');
    const keywords = /<meta name="keywords" content="([^"]*)"/.exec(source)?.[1];

    expect(keywords).toContain('nostr client');
    expect(keywords).not.toContain('undefined');
  });
});

describe('the two halves agree', () => {
  it('encodes an naddr the preview function can read back', () => {
    /*
     * The build encodes with nostr-tools and the function decodes with a
     * bech32 reader written out by hand. Either could be wrong on its own;
     * agreeing on a round trip is what says neither is.
     */
    const route = articleRoute(article());

    expect(filterFor(route.path.slice(1))).toEqual({
      kinds: [30023],
      authors: [
        'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6',
      ],
      '#d': ['my-article'],
    });
  });

  it('round-trips an identifier with characters that need encoding', () => {
    // The `d` tag is a slug somebody chose, not something this app generates
    const route = articleRoute({
      ...article(),
      tags: [['d', 'héllo-wörld'], ['title', 'T']],
    });

    expect(filterFor(route.path.slice(1))['#d']).toEqual(['héllo-wörld']);
  });
});
