import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  ARTICLE_DRAFT_KIND,
  ARTICLE_KIND,
  buildArticleTags,
  normalizeHashtags,
  parseArticle,
  parseHashtagInput,
  readingMinutes,
  slugify,
} from './article';

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'id',
    pubkey: 'a'.repeat(64),
    kind: ARTICLE_KIND,
    content: 'Body text.',
    tags: [['d', 'my-article']],
    created_at: 2000,
    sig: '',
    ...overrides,
  };
}

describe('parseArticle', () => {
  it('reads the metadata out of tags', () => {
    const article = parseArticle(
      event({
        tags: [
          ['d', 'my-article'],
          ['title', 'A title'],
          ['summary', 'A summary'],
          ['image', 'https://x/cover.png'],
          ['published_at', '1500'],
          ['t', 'Bitcoin'],
          ['t', 'nostr'],
        ],
      })
    );

    expect(article).toMatchObject({
      slug: 'my-article',
      title: 'A title',
      summary: 'A summary',
      image: 'https://x/cover.png',
      publishedAt: 1500,
      updatedAt: 2000,
      hashtags: ['bitcoin', 'nostr'],
      isDraft: false,
    });
  });

  it('marks a draft as one', () => {
    expect(parseArticle(event({ kind: ARTICLE_DRAFT_KIND }))?.isDraft).toBe(true);
  });

  it('rejects an article with no d tag, which has no address', () => {
    expect(parseArticle(event({ tags: [['title', 'Orphan']] }))).toBeNull();
  });

  it('rejects another kind', () => {
    expect(parseArticle(event({ kind: 1 }))).toBeNull();
  });

  it('falls back to the signing time when published_at is missing', () => {
    expect(parseArticle(event())?.publishedAt).toBe(2000);
  });

  it('falls back when published_at is not a number', () => {
    const article = parseArticle(
      event({ tags: [['d', 'x'], ['published_at', 'yesterday']] })
    );

    expect(article?.publishedAt).toBe(2000);
  });
});

describe('slugify', () => {
  it('makes a readable identifier', () => {
    expect(slugify('Hello, World! Part 2')).toBe('hello-world-part-2');
  });

  it('folds accents so one title cannot become two addresses', () => {
    expect(slugify('Café')).toBe('cafe');
  });

  it('trims punctuation from the ends', () => {
    expect(slugify('  ...Wait...  ')).toBe('wait');
  });

  it('caps the length', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(64);
  });

  it('never returns an empty address', () => {
    // A title in a non-Latin script leaves nothing behind, and an article
    // with no address cannot be linked to or replaced
    expect(slugify('!!!').length).toBeGreaterThan(0);
    expect(slugify('日本語').length).toBeGreaterThan(0);
  });
});

describe('buildArticleTags', () => {
  const base = {
    slug: 'my-article',
    title: 'A title',
    summary: '',
    content: 'Body',
    hashtags: [] as string[],
  };

  it('leads with the address', () => {
    expect(buildArticleTags(base)[0]).toEqual(['d', 'my-article']);
  });

  it('carries the original publication date through an edit', () => {
    const tags = buildArticleTags({ ...base, publishedAt: 1234 });

    expect(tags).toContainEqual(['published_at', '1234']);
  });

  it('stamps a publication date when there is none', () => {
    const stamped = buildArticleTags(base).find(
      ([name]) => name === 'published_at'
    );

    expect(Number(stamped?.[1])).toBeGreaterThan(0);
  });

  it('leaves out empty optional fields', () => {
    const tags = buildArticleTags(base);

    expect(tags.some(([name]) => name === 'summary')).toBe(false);
    expect(tags.some(([name]) => name === 'image')).toBe(false);
  });

  it('writes hashtags as single-letter t tags, which relays index', () => {
    const tags = buildArticleTags({ ...base, hashtags: ['Bitcoin', '#nostr'] });

    expect(tags).toContainEqual(['t', 'bitcoin']);
    expect(tags).toContainEqual(['t', 'nostr']);
  });
});

describe('normalizeHashtags', () => {
  it('lower-cases and strips leading hashes', () => {
    expect(normalizeHashtags(['#Bitcoin', 'NOSTR'])).toEqual([
      'bitcoin',
      'nostr',
    ]);
  });

  it('collapses spaces into hyphens', () => {
    expect(normalizeHashtags(['open source'])).toEqual(['open-source']);
  });

  it('removes duplicates and blanks', () => {
    expect(normalizeHashtags(['a', 'A', '', '  '])).toEqual(['a']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, index) => `tag${index}`);

    expect(normalizeHashtags(many)).toHaveLength(10);
  });
});

describe('parseHashtagInput', () => {
  it('accepts commas or spaces', () => {
    expect(parseHashtagInput('bitcoin, nostr  privacy')).toEqual([
      'bitcoin',
      'nostr',
      'privacy',
    ]);
  });

  it('returns nothing for an empty field', () => {
    expect(parseHashtagInput('   ')).toEqual([]);
  });
});

describe('readingMinutes', () => {
  it('never reports less than a minute', () => {
    expect(readingMinutes('short')).toBe(1);
  });

  it('scales with length', () => {
    expect(readingMinutes('word '.repeat(2200))).toBe(10);
  });
});

describe('buildArticleTags references', () => {
  const draft = {
    slug: 'lorem-ipsum',
    title: 'Lorem Ipsum',
    summary: '',
    content: '',
    hashtags: [],
    publishedAt: 1296962229,
  };

  it('tags people named in the body so the mention reaches them', () => {
    const tags = buildArticleTags(draft, { mentions: ['a'.repeat(64)] });
    expect(tags).toContainEqual(['p', 'a'.repeat(64)]);
  });

  it('cites events with q tags, whether by id or by address', () => {
    // NIP-27 names `q` for references written into text. An `e` tag would
    // file the citation among the cited event's replies instead
    const tags = buildArticleTags(draft, {
      quotes: [
        { value: 'b'.repeat(64), relay: 'wss://relay.example.com' },
        { value: `30023:${'c'.repeat(64)}:ipsum`, relay: 'wss://relay.nostr.org' },
      ],
    });

    expect(tags).toContainEqual(['q', 'b'.repeat(64), 'wss://relay.example.com']);
    expect(tags).toContainEqual([
      'q',
      `30023:${'c'.repeat(64)}:ipsum`,
      'wss://relay.nostr.org',
    ]);
    expect(tags.some(([name]) => name === 'e' || name === 'a')).toBe(false);
  });

  it('omits a relay hint it does not have rather than writing an empty one', () => {
    expect(buildArticleTags(draft, { quotes: [{ value: 'b'.repeat(64) }] })).toContainEqual(
      ['q', 'b'.repeat(64)]
    );
  });

  it('does not repeat a reference written twice', () => {
    const tags = buildArticleTags(draft, {
      mentions: ['a'.repeat(64), 'a'.repeat(64)],
      quotes: [{ value: 'b'.repeat(64) }, { value: 'b'.repeat(64) }],
    });

    expect(tags.filter(([name]) => name === 'p')).toHaveLength(1);
    expect(tags.filter(([name]) => name === 'q')).toHaveLength(1);
  });

  it('changes nothing when the body references nothing', () => {
    expect(buildArticleTags(draft)).toEqual(buildArticleTags(draft, {}));
  });
});
