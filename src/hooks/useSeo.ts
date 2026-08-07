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

  useHead({
    link: [{ rel: 'canonical', href: canonical }],
  });
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
