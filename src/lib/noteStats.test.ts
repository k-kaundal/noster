import { describe, it, expect } from 'vitest';
import { buildStatsFilters, profileStatsKey } from './noteStats';

const NOTE = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const ARTICLE = `30023:${'c'.repeat(64)}:my-post`;

/** The zap-receipt filter, which is the one this file exists for. */
function zapFilter(keys: string[], tag: '#e' | '#a' = '#e') {
  return buildStatsFilters(keys).find(
    (filter) => filter.kinds.includes(9735) && tag in filter
  );
}

describe('buildStatsFilters', () => {
  it('asks for zap receipts in a filter of their own', () => {
    /**
     * The bug this is about. A relay applies `limit` per filter and answers
     * newest-first, so zaps sharing a filter with reactions and replies get
     * crowded out by them — and the total reads zero for a post that was
     * definitely paid.
     */
    const filters = buildStatsFilters([NOTE, OTHER]);

    const social = filters.find((filter) => filter.kinds.includes(7));
    const zaps = filters.find((filter) => filter.kinds.includes(9735));

    expect(social).toBeDefined();
    expect(zaps).toBeDefined();
    expect(social).not.toBe(zaps);
    expect(social!.kinds).not.toContain(9735);
  });

  it('asks for every note in the batch, in both filters', () => {
    const filters = buildStatsFilters([NOTE, OTHER]);

    for (const filter of filters) {
      expect(filter['#e']).toEqual([NOTE, OTHER]);
    }
  });

  it('references an article by coordinate, never by id', () => {
    // An article's zaps carry `a` and frequently no `e` at all, so a query
    // asking only for `#e` finds none of them
    const filters = buildStatsFilters([ARTICLE]);

    expect(filters).toHaveLength(2);
    expect(zapFilter([ARTICLE], '#a')?.['#a']).toEqual([ARTICLE]);
    expect(filters.some((filter) => '#e' in filter)).toBe(false);
  });

  it('splits a mixed batch into id filters and coordinate filters', () => {
    const filters = buildStatsFilters([NOTE, ARTICLE]);

    expect(filters).toHaveLength(4);
    expect(zapFilter([NOTE, ARTICLE], '#e')?.['#e']).toEqual([NOTE]);
    expect(zapFilter([NOTE, ARTICLE], '#a')?.['#a']).toEqual([ARTICLE]);
  });

  it('asks for nothing when there is nothing to ask about', () => {
    expect(buildStatsFilters([])).toEqual([]);
  });

  it('keeps limits inside what a relay will answer', () => {
    const many = Array.from({ length: 60 }, (_, index) => String(index).repeat(4));

    for (const filter of buildStatsFilters(many)) {
      expect(filter.limit).toBeLessThanOrEqual(2000);
      expect(filter.limit).toBeGreaterThan(0);
    }
  });
});

describe('profile zaps', () => {
  it('asks for receipts by p, not by any id', () => {
    // A profile zap carries a p tag and no e or a, so no id-shaped question
    // can ever find one
    const filters = buildStatsFilters([profileStatsKey('a'.repeat(64))]);

    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatchObject({
      kinds: [9735],
      '#p': ['a'.repeat(64)],
    });
  });

  it('does not ask for social kinds by p', () => {
    // On a note, p means "mentioned" — the same filter would report every
    // reply that name-dropped somebody as a reply to them
    const filters = buildStatsFilters([profileStatsKey('a'.repeat(64))]);

    expect(filters.some((filter) => filter.kinds.includes(1))).toBe(false);
  });

  it('keeps a profile key out of the event-id filter', () => {
    const eventId = 'b'.repeat(64);

    const filters = buildStatsFilters([
      eventId,
      profileStatsKey('a'.repeat(64)),
    ]);

    for (const filter of filters) {
      if ('#e' in filter) expect(filter['#e']).toEqual([eventId]);
    }
  });

  it('tells an address apart from a profile key', () => {
    // Both contain a colon; only a coordinate starts with its kind
    const address = `30023:${'c'.repeat(64)}:my-article`;

    const filters = buildStatsFilters([
      address,
      profileStatsKey('a'.repeat(64)),
    ]);

    const byAddress = filters.filter((filter) => '#a' in filter);
    expect(byAddress).toHaveLength(2);
    for (const filter of byAddress) {
      expect(filter['#a']).toEqual([address]);
    }
  });

  it('handles all three kinds of key at once', () => {
    const filters = buildStatsFilters([
      'b'.repeat(64),
      `30023:${'c'.repeat(64)}:x`,
      profileStatsKey('a'.repeat(64)),
    ]);

    expect(filters.some((filter) => '#e' in filter)).toBe(true);
    expect(filters.some((filter) => '#a' in filter)).toBe(true);
    expect(filters.some((filter) => '#p' in filter)).toBe(true);
  });
});
