import { describe, it, expect } from 'vitest';
import { SITE_ROUTES, indexableRoutes, routeSeo } from './siteRoutes';

describe('SITE_ROUTES', () => {
  it('describes every route it lists', () => {
    for (const route of SITE_ROUTES) {
      expect(route.path.startsWith('/')).toBe(true);
      expect(route.title.length).toBeGreaterThan(0);
      expect(route.description.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate paths', () => {
    // A duplicate would put two <url> entries for one page in the sitemap and
    // write one route's HTML over another's
    const paths = SITE_ROUTES.map((route) => route.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('keeps descriptions inside what a search result shows', () => {
    /**
     * Google truncates around 160 characters. A longer one is not penalised,
     * it is simply cut — usually mid-sentence, which reads as a broken page.
     */
    for (const route of SITE_ROUTES) {
      expect(route.description.length).toBeLessThanOrEqual(200);
    }
  });

  it('gives every indexable route a crawl priority', () => {
    for (const route of indexableRoutes()) {
      expect(route.priority).toBeGreaterThan(0);
      expect(route.priority).toBeLessThanOrEqual(1);
    }
  });

  it('keeps signed-in pages out of the sitemap', () => {
    const listed = indexableRoutes().map((route) => route.path);

    // A search result promising somebody's wallet or messages is a bad result
    expect(listed).not.toContain('/wallet');
    expect(listed).not.toContain('/settings');
    expect(listed).not.toContain('/chat');
  });

  it('still describes those pages, since a shared link shows a card either way', () => {
    expect(routeSeo('/wallet')?.description).toBeTruthy();
  });

  it('leads with the home page', () => {
    expect(SITE_ROUTES[0].path).toBe('/');
    expect(SITE_ROUTES[0].priority).toBe(1);
  });
});
