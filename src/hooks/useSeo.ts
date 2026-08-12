import { useHead, useSeoMeta } from '@unhead/react';
import { useLocation } from 'react-router-dom';

/** Canonical origin used for absolute URLs in metadata. */
export const SITE_URL = 'https://nostrfeed.com';
export const SITE_NAME = 'NostrFeed';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

export interface SeoOptions {
  title: string;
  description: string;
  /** Absolute or root-relative image URL for the social card. */
  image?: string;
  /** Overrides the canonical path; defaults to the current route. */
  path?: string;
  /** `article` and `profile` give richer previews than the default. */
  type?: 'website' | 'article' | 'profile';
  /** Keeps thin or duplicate pages out of search results. */
  noindex?: boolean;
  /** ISO timestamps used for article previews. */
  publishedTime?: string;
  author?: string;
  /**
   * The Nostr entity this page is another rendering of.
   *
   * NIP-21: `<link rel="alternate">` associates a web page with the event it
   * serves, "in cases where the same content is served via the two mediums".
   * An article page here is exactly that — the same kind 30023 as HTML — and
   * without the link a reader who arrives by search has no way back to the
   * event, which is the copy that is portable.
   *
   * A bare NIP-19 identifier; the `nostr:` prefix is added when written.
   */
  nostrEntity?: string;
  /**
   * The Nostr profile this page belongs to.
   *
   * `rel="me"` and `rel="author"` are what NIP-21 names for assigning
   * authorship, and they are different claims: `me` says this page *is* that
   * identity, `author` says that identity wrote it. A profile page is both;
   * an article page is only the second.
   */
  nostrAuthor?: string;
  /** Whether `nostrAuthor` also identifies the page itself. */
  authorIsSelf?: boolean;
}

function absolute(url: string | undefined): string {
  if (!url) return DEFAULT_OG_IMAGE;
  if (/^https?:\/\//i.test(url)) return url;
  return `${SITE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Applies the full metadata set for a page: title, description, canonical URL,
 * Open Graph and Twitter cards. Crawlers and chat apps read different subsets,
 * so all three are emitted rather than relying on inference.
 */
export function useSeo({
  title,
  description,
  image,
  path,
  type = 'website',
  noindex = false,
  publishedTime,
  author,
  nostrEntity,
  nostrAuthor,
  authorIsSelf = false,
}: SeoOptions) {
  const location = useLocation();
  const canonical = `${SITE_URL}${path ?? location.pathname}`;
  const ogImage = absolute(image);

  // Titles read better with the brand appended, except on the home page
  const fullTitle = title.includes(SITE_NAME)
    ? title
    : `${title} · ${SITE_NAME}`;

  useSeoMeta({
    title: fullTitle,
    description,

    ogType: type,
    ogTitle: fullTitle,
    ogDescription: description,
    ogUrl: canonical,
    ogImage,
    ogImageAlt: title,
    ogSiteName: SITE_NAME,

    twitterCard: 'summary_large_image',
    twitterTitle: fullTitle,
    twitterDescription: description,
    twitterImage: ogImage,

    robots: noindex ? 'noindex, follow' : 'index, follow',
    articlePublishedTime: publishedTime,
    // The spec allows several authors, so this field is always a list
    articleAuthor: author ? [author] : undefined,
  });

  /**
   * Built rather than written inline so the empty cases drop out. A `link`
   * with an undefined `href` renders as an attribute-less tag, which is worse
   * than no tag: a crawler reads it as a broken alternate.
   */
  const links: { rel: string; href: string }[] = [
    { rel: 'canonical', href: canonical },
  ];

  if (nostrEntity) {
    links.push({ rel: 'alternate', href: `nostr:${nostrEntity}` });
  }

  if (nostrAuthor) {
    const href = `nostr:${nostrAuthor}`;

    links.push({ rel: 'author', href });
    if (authorIsSelf) links.push({ rel: 'me', href });
  }

  useHead({ link: links });
}

/**
 * Emits JSON-LD describing the site itself. Kept in React rather than
 * index.html because the HTML lint rules disallow inline scripts there.
 */
export function useSiteStructuredData() {
  useHead({
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'WebSite',
              '@id': `${SITE_URL}/#website`,
              url: SITE_URL,
              name: SITE_NAME,
              description:
                'A fast, open Nostr client for reading and publishing on the decentralized social network.',
              potentialAction: {
                '@type': 'SearchAction',
                target: {
                  '@type': 'EntryPoint',
                  urlTemplate: `${SITE_URL}/?q={search_term_string}`,
                },
                'query-input': 'required name=search_term_string',
              },
            },
            {
              '@type': 'WebApplication',
              '@id': `${SITE_URL}/#app`,
              name: SITE_NAME,
              url: SITE_URL,
              applicationCategory: 'SocialNetworkingApplication',
              operatingSystem: 'Any',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            },
          ],
        }),
      },
    ],
  });
}
