/**
 * Schema.org descriptions of the things on this site.
 *
 * Meta tags say how a page should look when it is shared. This says what the
 * page *is* — that a URL is an article, written by a person, published on a
 * date; that another is that person's profile. Search engines use it to build
 * a result, and assistants use it because it is the one part of a page that
 * does not have to be inferred from prose.
 *
 * It matters more here than on an ordinary site. The content on these pages
 * arrives from relays after the HTML does, so anything reading the markup has
 * very little to go on; a description of the page's subject is worth more than
 * the markup it is describing.
 *
 * Pure builders, so they can be checked without a browser. Nothing here emits
 * anything — `useSeo` does that.
 */

export const SITE_URL = 'https://nostrfeed.com';
export const SITE_NAME = 'NostrFeed';

/** Anything JSON-LD can hold. Narrow enough to keep `any` out of the app. */
export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | JsonLdValue[]
  | { [key: string]: JsonLdValue };

export type JsonLd = Record<string, JsonLdValue>;

/**
 * Drops empty fields.
 *
 * An `image` of `undefined` serialises to nothing useful and a `""` is worse:
 * it asserts the article has an image and that the image is nowhere. Both make
 * a validator complain, and a schema block that fails validation is ignored
 * whole rather than in part.
 */
function compact(input: Record<string, JsonLdValue | undefined>): JsonLd {
  const output: JsonLd = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && !value.length) continue;
    output[key] = value;
  }

  return output;
}

export interface PersonInput {
  name: string;
  /** The `npub`, which is the identity — the URL is only where it is rendered. */
  npub: string;
  about?: string;
  image?: string;
  /** A verified NIP-05 identifier, when the profile carries one. */
  nip05?: string;
  website?: string;
}

/**
 * A person, identified by their key rather than by this site's URL for them.
 *
 * `sameAs` carries the `nostr:` URI: the same person is reachable through
 * every other Nostr client, and a schema that named only this site's page
 * would describe an identity that does not depend on us as though it did.
 */
export function personSchema(person: PersonInput): JsonLd {
  const url = `${SITE_URL}/${person.npub}`;

  const sameAs: string[] = [`nostr:${person.npub}`];
  if (person.website) sameAs.push(person.website);

  return compact({
    '@type': 'Person',
    '@id': `${url}#person`,
    name: person.name,
    url,
    description: person.about,
    image: person.image,
    identifier: person.npub,
    alternateName: person.nip05,
    sameAs,
  });
}

export function profilePageSchema(person: PersonInput): JsonLd {
  const url = `${SITE_URL}/${person.npub}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': `${url}#page`,
    url,
    name: person.name,
    mainEntity: personSchema(person),
  };
}

export interface ArticleInput {
  title: string;
  description?: string;
  image?: string;
  /** The NIP-19 address this article is served at, without a leading slash. */
  identifier: string;
  publishedAt: number;
  updatedAt?: number;
  author: PersonInput;
  /** Hashtags on the event, which are the article's subjects. */
  tags?: string[];
  /** Rough length, for a reader deciding whether to open it. */
  wordCount?: number;
}

export function articleSchema(article: ArticleInput): JsonLd {
  const url = `${SITE_URL}/${article.identifier}`;

  return {
    '@context': 'https://schema.org',
    ...compact({
      '@type': 'Article',
      '@id': `${url}#article`,
      headline: article.title.slice(0, 110),
      description: article.description,
      image: article.image,
      url,
      mainEntityOfPage: url,
      datePublished: isoDate(article.publishedAt),
      dateModified: isoDate(article.updatedAt ?? article.publishedAt),
      author: personSchema(article.author),
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_URL,
      },
      keywords: article.tags?.length ? article.tags.join(', ') : undefined,
      wordCount: article.wordCount,
      /*
       * Said outright, because it is the unusual part: the article is a Nostr
       * event that exists independently of this page, and the page is one
       * rendering of it.
       */
      isBasedOn: `nostr:${article.identifier}`,
    }),
  };
}

export interface NoteInput {
  /** `note1…`, the identifier the note is served at. */
  identifier: string;
  text: string;
  publishedAt: number;
  author: PersonInput;
  image?: string;
}

/**
 * A short note.
 *
 * `SocialMediaPosting` rather than `Article`: a note has no headline, and
 * describing one as an article produces a result page that promises a piece of
 * writing and delivers a sentence.
 */
export function notePostingSchema(note: NoteInput): JsonLd {
  const url = `${SITE_URL}/${note.identifier}`;

  return {
    '@context': 'https://schema.org',
    ...compact({
      '@type': 'SocialMediaPosting',
      '@id': `${url}#post`,
      url,
      mainEntityOfPage: url,
      datePublished: isoDate(note.publishedAt),
      author: personSchema(note.author),
      articleBody: note.text.slice(0, 500),
      image: note.image,
      isBasedOn: `nostr:${note.identifier}`,
    }),
  };
}

/** Unix seconds to an ISO date, or nothing when the timestamp is unusable. */
function isoDate(seconds: number | undefined): string | undefined {
  if (!seconds || !Number.isFinite(seconds)) return undefined;

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
