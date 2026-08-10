import type { NostrEvent } from '@nostrify/nostrify';

/** NIP-23 long-form content. Drafts use the neighbouring kind. */
export const ARTICLE_KIND = 30023;
export const ARTICLE_DRAFT_KIND = 30024;

export interface Article {
  /** The `d` tag, which together with the author addresses the article. */
  slug: string;
  title: string;
  summary: string;
  image?: string;
  /** Markdown. */
  content: string;
  hashtags: string[];
  /** First publication, which survives later edits. */
  publishedAt: number;
  /** When this revision was signed. */
  updatedAt: number;
  isDraft: boolean;
  event: NostrEvent;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([key]) => key === name)?.[1] || undefined;
}

/**
 * Reads an article out of its event.
 *
 * Everything except the body lives in tags, because relays only index tags —
 * a title in the content could not be searched or listed without downloading
 * every article in full.
 */
export function parseArticle(event: NostrEvent): Article | null {
  if (event.kind !== ARTICLE_KIND && event.kind !== ARTICLE_DRAFT_KIND) {
    return null;
  }

  const slug = tagValue(event, 'd');
  if (!slug) return null;

  const published = Number(tagValue(event, 'published_at'));

  return {
    slug,
    title: tagValue(event, 'title') || 'Untitled',
    summary: tagValue(event, 'summary') || '',
    image: tagValue(event, 'image'),
    content: event.content,
    hashtags: event.tags
      .filter(([name, value]) => name === 't' && !!value)
      .map(([, value]) => value.toLowerCase()),
    // A missing or malformed published_at falls back to when it was signed
    publishedAt:
      Number.isFinite(published) && published > 0 ? published : event.created_at,
    updatedAt: event.created_at,
    isDraft: event.kind === ARTICLE_DRAFT_KIND,
    event,
  };
}

/** True when an article carries enough to be worth a row in a list. */
export function isRenderableArticle(event: NostrEvent): boolean {
  const article = parseArticle(event);
  return !!article && !!article.content.trim();
}

/**
 * Turns a title into a URL-safe identifier.
 *
 * The slug is the article's address: editing republishes under the same `d`
 * tag and replaces the old revision, so it has to stay stable even as the
 * title changes. It is generated once, from the first title, and then left
 * alone.
 */
export function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    // Strip accents, so "Café" and "Cafe" do not become different addresses
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');

  // A title of only punctuation or non-Latin script leaves nothing behind,
  // and an article with no address cannot be replaced or linked to
  return base || `article-${Date.now().toString(36)}`;
}

export interface ArticleDraft {
  slug: string;
  title: string;
  summary: string;
  image?: string;
  content: string;
  hashtags: string[];
  /** Preserved across edits so the byline keeps saying when it first appeared. */
  publishedAt?: number;
}

/**
 * Things an article's text points at, lifted into tags.
 *
 * NIP-23 sends references through NIP-27: write them as `nostr:` links in the
 * body, and add tags for them. The tags are what make the reference exist to
 * anything other than a reader of that exact paragraph — a mentioned author
 * is notified through `p`, and a cited article is discoverable through `a`.
 */
export interface ArticleReferences {
  /** Pubkeys named in the body. */
  mentions?: string[];
  /** Events cited in the body, by id or by `kind:pubkey:d` address. */
  quotes?: Array<{ value: string; relay?: string }>;
}

/** The tags for a NIP-23 article. */
export function buildArticleTags(
  draft: ArticleDraft,
  references: ArticleReferences = {}
): string[][] {
  const tags: string[][] = [['d', draft.slug]];

  if (draft.title.trim()) tags.push(['title', draft.title.trim()]);
  if (draft.summary.trim()) tags.push(['summary', draft.summary.trim()]);
  if (draft.image?.trim()) tags.push(['image', draft.image.trim()]);

  tags.push([
    'published_at',
    String(draft.publishedAt ?? Math.floor(Date.now() / 1000)),
  ]);

  // Single-letter `t` tags are what relays index, so this is what makes an
  // article findable by topic rather than only by author
  for (const tag of normalizeHashtags(draft.hashtags)) {
    tags.push(['t', tag]);
  }

  const mentioned = new Set<string>();
  for (const pubkey of references.mentions ?? []) {
    if (pubkey && !mentioned.has(pubkey)) {
      mentioned.add(pubkey);
      tags.push(['p', pubkey]);
    }
  }

  /**
   * An address goes in an `a` tag and an id in an `e` tag, as NIP-23's own
   * example shows. Which one a citation is decides whether it survives the
   * cited author editing their post: an address follows the article, an id
   * names one revision of it.
   */
  const cited = new Set<string>();
  for (const quote of references.quotes ?? []) {
    if (!quote.value || cited.has(quote.value)) continue;
    cited.add(quote.value);

    const name = quote.value.includes(':') ? 'a' : 'e';
    tags.push(quote.relay ? [name, quote.value, quote.relay] : [name, quote.value]);
  }

  return tags;
}

/** Cleans a list of typed hashtags into what belongs in `t` tags. */
export function normalizeHashtags(input: string[]): string[] {
  const seen = new Set<string>();

  for (const raw of input) {
    const tag = raw
      .trim()
      .replace(/^#+/, '')
      .toLowerCase()
      .replace(/\s+/g, '-');

    if (tag) seen.add(tag);
  }

  return [...seen].slice(0, 10);
}

/** Splits a comma or space separated field into hashtags. */
export function parseHashtagInput(value: string): string[] {
  return normalizeHashtags(value.split(/[,\s]+/));
}

/** Roughly how long an article takes to read, in minutes. */
export function readingMinutes(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
