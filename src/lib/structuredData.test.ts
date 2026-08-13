import { describe, it, expect } from 'vitest';
import {
  SITE_URL,
  articleSchema,
  notePostingSchema,
  personSchema,
  profilePageSchema,
} from './structuredData';

const NPUB = 'npub1alice';
const NADDR = 'naddr1article';

const person = {
  name: 'Alice',
  npub: NPUB,
  about: 'Writes about relays.',
  image: 'https://example.com/alice.jpg',
  nip05: 'alice@getzap.me',
};

describe('personSchema', () => {
  it('identifies the person by their key, not by our URL for them', () => {
    /**
     * The same person is reachable through every other Nostr client. A schema
     * naming only this site's page would describe an identity that does not
     * depend on us as though it did.
     */
    const schema = personSchema(person);

    expect(schema.identifier).toBe(NPUB);
    expect(schema.sameAs).toContain(`nostr:${NPUB}`);
    expect(schema.url).toBe(`${SITE_URL}/${NPUB}`);
  });

  it('includes a website when the profile has one', () => {
    expect(
      personSchema({ ...person, website: 'https://alice.example' }).sameAs
    ).toContain('https://alice.example');
  });

  it('leaves empty fields out rather than asserting nothing', () => {
    // `image: ""` claims there is an image and that it is nowhere, which
    // fails validation and gets the whole block ignored
    const schema = personSchema({ name: 'Bob', npub: 'npub1bob', image: '' });

    expect(schema).not.toHaveProperty('image');
    expect(schema).not.toHaveProperty('description');
  });
});

describe('profilePageSchema', () => {
  it('describes the page and the person it is about', () => {
    const schema = profilePageSchema(person);

    expect(schema['@type']).toBe('ProfilePage');
    expect(schema.mainEntity).toMatchObject({ '@type': 'Person', name: 'Alice' });
  });
});

describe('articleSchema', () => {
  const article = {
    title: 'Why relays matter',
    description: 'A short summary.',
    image: 'https://example.com/cover.jpg',
    identifier: NADDR,
    publishedAt: 1_760_000_000,
    updatedAt: 1_760_100_000,
    tags: ['nostr', 'relays'],
    author: person,
  };

  it('describes an article at its own URL', () => {
    const schema = articleSchema(article);

    expect(schema['@type']).toBe('Article');
    expect(schema.url).toBe(`${SITE_URL}/${NADDR}`);
    expect(schema.headline).toBe('Why relays matter');
  });

  it('says the page is a rendering of the event', () => {
    // The unusual part, and the part worth stating: the article exists
    // independently of this page
    expect(articleSchema(article).isBasedOn).toBe(`nostr:${NADDR}`);
  });

  it('converts unix seconds to ISO dates', () => {
    const schema = articleSchema(article);

    expect(schema.datePublished).toBe(
      new Date(1_760_000_000 * 1000).toISOString()
    );
    expect(schema.dateModified).toBe(
      new Date(1_760_100_000 * 1000).toISOString()
    );
  });

  it('falls back to the publication date when nothing was edited', () => {
    const schema = articleSchema({ ...article, updatedAt: undefined });

    expect(schema.dateModified).toBe(schema.datePublished);
  });

  it('drops an unusable timestamp instead of emitting an invalid date', () => {
    const schema = articleSchema({ ...article, publishedAt: 0, updatedAt: 0 });

    expect(schema).not.toHaveProperty('datePublished');
  });

  it('keeps the headline inside what a result can show', () => {
    const schema = articleSchema({ ...article, title: 'x'.repeat(200) });

    expect(String(schema.headline)).toHaveLength(110);
  });
});

describe('notePostingSchema', () => {
  const note = {
    identifier: 'note1abc',
    text: 'Hello from a relay.',
    publishedAt: 1_760_000_000,
    author: person,
  };

  it('describes a note as a post rather than an article', () => {
    // A note has no headline; calling it an article promises a piece of
    // writing and delivers a sentence
    expect(notePostingSchema(note)['@type']).toBe('SocialMediaPosting');
  });

  it('caps the body rather than pasting a whole thread into the head', () => {
    const schema = notePostingSchema({ ...note, text: 'y'.repeat(900) });

    expect(String(schema.articleBody)).toHaveLength(500);
  });
});
