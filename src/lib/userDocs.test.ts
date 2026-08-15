import { describe, it, expect } from 'vitest';
import {
  DOCS,
  DOC_PATHS,
  DOC_SECTIONS,
  docNeighbours,
  docsInSection,
  findDoc,
  internalDocLinks,
  searchDocs,
} from './userDocs';
import { SITE_ROUTES } from './siteRoutes';

describe('the manual holds together', () => {
  it('gives every doc a unique slug', () => {
    const slugs = DOCS.map((doc) => doc.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses url-safe slugs', () => {
    for (const doc of DOCS) {
      expect(doc.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('files every doc under a section that exists', () => {
    const known = new Set(DOC_SECTIONS.map((section) => section.id));
    for (const doc of DOCS) {
      expect(known.has(doc.section)).toBe(true);
    }
  });

  it('leaves no section empty', () => {
    // An empty heading in the contents reads as something failing to load
    for (const section of DOC_SECTIONS) {
      expect(docsInSection(section.id).length).toBeGreaterThan(0);
    }
  });

  it('has no dead internal links', () => {
    // The reason the manual is data: a cross-reference that 404s is the one
    // documentation bug nobody notices until a reader is already lost
    for (const doc of DOCS) {
      for (const slug of internalDocLinks(doc)) {
        expect(findDoc(slug), `${doc.slug} links to ${slug}`).not.toBeNull();
      }
    }
  });

  it('never links a doc to itself', () => {
    for (const doc of DOCS) {
      expect(internalDocLinks(doc)).not.toContain(doc.slug);
    }
  });

  it('gives every doc a title, a summary and a body', () => {
    for (const doc of DOCS) {
      expect(doc.title.trim()).not.toBe('');
      expect(doc.summary.trim()).not.toBe('');
      expect(doc.body.trim().length).toBeGreaterThan(200);
    }
  });

  it('lists a path for the contents and every article', () => {
    expect(DOC_PATHS).toContain('/docs');
    expect(DOC_PATHS).toHaveLength(DOCS.length + 1);
  });
});

describe('findDoc', () => {
  it('finds a doc by slug', () => {
    expect(findDoc('relays')?.title).toBe('Relays');
  });

  it('answers null for anything else', () => {
    expect(findDoc('no-such-page')).toBeNull();
    expect(findDoc(undefined)).toBeNull();
    expect(findDoc('')).toBeNull();
  });
});

describe('docNeighbours', () => {
  it('has nothing before the first', () => {
    const { previous, next } = docNeighbours(DOCS[0].slug);
    expect(previous).toBeNull();
    expect(next?.slug).toBe(DOCS[1].slug);
  });

  it('has nothing after the last', () => {
    const last = DOCS[DOCS.length - 1];
    expect(docNeighbours(last.slug).next).toBeNull();
  });

  it('runs through the whole manual, not just one section', () => {
    // Otherwise the sequence dead-ends at each section's final page
    const boundary = DOCS.findIndex(
      (doc, index) => index > 0 && doc.section !== DOCS[index - 1].section
    );

    expect(boundary).toBeGreaterThan(0);
    expect(docNeighbours(DOCS[boundary].slug).previous?.slug).toBe(
      DOCS[boundary - 1].slug
    );
  });

  it('answers nothing for a slug that is not in the manual', () => {
    expect(docNeighbours('no-such-page')).toEqual({
      previous: null,
      next: null,
    });
  });
});

describe('searchDocs', () => {
  it('finds nothing for an empty query', () => {
    expect(searchDocs('')).toEqual([]);
    expect(searchDocs('   ')).toEqual([]);
  });

  it('puts a title match first', () => {
    // "wallet" appears in several bodies; the page called The wallet wins
    expect(searchDocs('wallet')[0].slug).toBe('wallet');
  });

  it('matches words that appear nowhere but the keywords', () => {
    // People search for the spec they read about, not our heading
    expect(searchDocs('nip-05').map((doc) => doc.slug)).toContain(
      'verified-names'
    );
    expect(searchDocs('nsec').map((doc) => doc.slug)).toContain('your-keys');
  });

  it('finds the troubleshooting page from the symptom', () => {
    expect(searchDocs('zap count zero').map((doc) => doc.slug)).toContain(
      'zap-not-showing'
    );
  });

  it('requires every word to land somewhere', () => {
    // Otherwise a second word only ever widens the results, which is the
    // opposite of what typing more is meant to do
    expect(searchDocs('wallet zzzznonsense')).toEqual([]);
  });

  it('ignores case and surrounding space', () => {
    expect(searchDocs('  RELAYS ')[0].slug).toBe('relays');
  });
});

describe('the manual is honest about the limits', () => {
  it('says notifications do not arrive when the app is closed', () => {
    // The one promise it would be easiest and worst to imply
    const doc = findDoc('notifications');
    expect(doc?.body).toMatch(/fully closed/i);
  });

  it('says the wallet is custodial', () => {
    expect(findDoc('wallet')?.body).toMatch(/custodial/i);
  });

  it('says a lost key cannot be recovered', () => {
    expect(findDoc('your-keys')?.body).toMatch(/no recovery|cannot take it back/i);
  });

  it('says addresses are never deleted', () => {
    expect(findDoc('lightning-address')?.body).toMatch(/never deleted/i);
  });
});

describe('the sitemap and the manual agree', () => {
  /*
   * `siteRoutes` deliberately imports nothing, so the doc URLs are written out
   * there a second time. Two copies of the same list is exactly how a sitemap
   * comes to advertise a page that was renamed six months ago — so the copies
   * are compared here instead of trusted.
   */
  const documented = new Set(
    SITE_ROUTES.filter((route) => route.path.startsWith('/docs')).map(
      (route) => route.path
    )
  );

  it('lists every doc page', () => {
    for (const path of DOC_PATHS) {
      expect(documented.has(path), `${path} missing from SITE_ROUTES`).toBe(true);
    }
  });

  it('advertises no doc page that does not exist', () => {
    for (const path of documented) {
      expect(DOC_PATHS, `${path} is not a real doc`).toContain(path);
    }
  });

  it('carries the doc title and summary', () => {
    for (const doc of DOCS) {
      const route = SITE_ROUTES.find(
        (entry) => entry.path === `/docs/${doc.slug}`
      );

      expect(route?.title).toBe(doc.title);
      expect(route?.description).toBe(doc.summary);
    }
  });
});
