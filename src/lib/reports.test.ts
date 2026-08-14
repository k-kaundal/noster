import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  REPORT_KIND,
  buildReportTags,
  describeReports,
  indexReports,
  parseReport,
  reportableBlobs,
  shouldBlurMedia,
} from './reports';

const THEM = 'b'.repeat(64);
const NOTE = 'd'.repeat(64);
const HASH = '3'.repeat(64);

function reporter(index: number): string {
  return String(index).repeat(64).slice(0, 64);
}

function report(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '0'.repeat(64),
    pubkey: reporter(1),
    created_at: 0,
    kind: REPORT_KIND,
    tags: [['p', THEM, 'nudity']],
    content: '',
    sig: '',
    ...overrides,
  };
}

describe('buildReportTags', () => {
  it('tags the author with the report type', () => {
    expect(buildReportTags({ pubkey: THEM, type: 'spam' })).toEqual([
      ['p', THEM, 'spam'],
    ]);
  });

  it('types the note and leaves the author untyped', () => {
    /**
     * The spec's own shape for a note report:
     *
     *     ["e", "<eventId>", "illegal"],
     *     ["p", "<pubkey>"]
     *
     * The type belongs to the tag being reported. Stamping it on `p` too says
     * the account is illegal rather than the post, which is a different and
     * much larger claim — and it is the claim the suggested blur reads.
     */
    const tags = buildReportTags({
      pubkey: THEM,
      eventId: NOTE,
      kind: 1,
      type: 'illegal',
    });

    expect(tags).toEqual([
      ['p', THEM],
      ['e', NOTE, 'illegal'],
      ['k', '1'],
    ]);
  });

  it('omits the kind tag when the kind is unknown', () => {
    const tags = buildReportTags({ pubkey: THEM, eventId: NOTE, type: 'other' });
    expect(tags.some(([name]) => name === 'k')).toBe(false);
  });

  it('labels a nudity report with the one published ontology code', () => {
    const tags = buildReportTags({ pubkey: THEM, type: 'nudity' });

    expect(tags).toContainEqual(['L', 'social.nos.ontology']);
    expect(tags).toContainEqual(['l', 'NS-nud', 'social.nos.ontology']);
  });

  it('invents no ontology code for types that have none', () => {
    for (const type of ['spam', 'illegal', 'malware', 'other'] as const) {
      const tags = buildReportTags({ pubkey: THEM, type });
      expect(tags.some(([name]) => name === 'l')).toBe(false);
    }
  });

  it('carries the blob hash and its server', () => {
    const tags = buildReportTags({
      pubkey: THEM,
      eventId: NOTE,
      type: 'malware',
      blob: { hash: HASH, server: 'https://blobs.example' },
    });

    expect(tags).toContainEqual(['x', HASH, 'malware']);
    expect(tags).toContainEqual(['server', 'https://blobs.example']);
  });

  it('drops a blob report with no event, which the spec forbids', () => {
    const tags = buildReportTags({
      pubkey: THEM,
      type: 'malware',
      blob: { hash: HASH },
    });

    expect(tags.some(([name]) => name === 'x')).toBe(false);
  });

  it('never emits an x tag without an e tag', () => {
    const inputs = [
      { pubkey: THEM, type: 'malware' as const, blob: { hash: HASH } },
      { pubkey: THEM, eventId: NOTE, type: 'malware' as const, blob: { hash: HASH } },
    ];

    for (const input of inputs) {
      const tags = buildReportTags(input);

      if (tags.some(([name]) => name === 'x')) {
        expect(tags.some(([name]) => name === 'e')).toBe(true);
      }
    }
  });
});

describe('reportableBlobs', () => {
  it('reads the hash and url out of imeta tags', () => {
    const event = report({
      kind: 1,
      tags: [
        ['imeta', `url https://cdn.example/a.jpg`, `x ${HASH}`, 'm image/jpeg'],
      ],
    });

    expect(reportableBlobs(event)).toEqual([
      {
        hash: HASH,
        url: 'https://cdn.example/a.jpg',
        server: 'https://cdn.example',
      },
    ]);
  });

  it('skips attachments with no hash to report', () => {
    const event = report({
      kind: 1,
      tags: [['imeta', 'url https://cdn.example/a.jpg']],
    });

    expect(reportableBlobs(event)).toEqual([]);
  });
});

describe('parseReport', () => {
  it('reads the type from the e tag when the p tag has none', () => {
    const parsed = parseReport(
      report({ tags: [['e', NOTE, 'illegal'], ['p', THEM]] })
    );

    expect(parsed?.type).toBe('illegal');
    expect(parsed?.eventId).toBe(NOTE);
  });

  it('files an unrecognised type as other rather than dropping it', () => {
    const parsed = parseReport(report({ tags: [['p', THEM, 'vibes']] }));
    expect(parsed?.type).toBe('other');
  });

  it('ignores a report of its own author', () => {
    expect(parseReport(report({ tags: [['p', reporter(1), 'spam']] }))).toBeNull();
  });

  it('reads a report that names a note but no account', () => {
    /**
     * `p` is a MUST that the spec's own malware example does not keep, so
     * requiring it here would throw away exactly the reports the NIP
     * demonstrates. A report naming a note is still evidence about that note.
     */
    const parsed = parseReport(report({ tags: [['e', NOTE, 'spam']] }));

    expect(parsed?.eventId).toBe(NOTE);
    expect(parsed?.pubkey).toBeUndefined();
    expect(parsed?.type).toBe('spam');
  });

  it('ignores an event that reports nothing at all', () => {
    expect(parseReport(report({ tags: [['k', '1']] }))).toBeNull();
  });

  it('tells a report about an account from one about a post', () => {
    expect(
      parseReport(report({ tags: [['p', THEM, 'nudity']] }))?.aboutProfile
    ).toBe(true);

    expect(
      parseReport(
        report({ tags: [['p', THEM], ['e', NOTE, 'nudity']] })
      )?.aboutProfile
    ).toBe(false);
  });
});

describe('indexReports', () => {
  it('counts each reporter once however many reports they file', () => {
    const events = [
      report({ id: '1'.repeat(64) }),
      report({ id: '2'.repeat(64) }),
      report({ id: '3'.repeat(64) }),
    ];

    const summary = indexReports(events).byPubkey.get(THEM);

    expect(summary?.counts.nudity).toBe(1);
    expect(shouldBlurMedia(summary)).toBe(false);
  });

  it('blurs once three separate followed accounts agree', () => {
    const events = [1, 2, 3].map((n) =>
      report({ id: String(n).repeat(64), pubkey: reporter(n) })
    );

    expect(shouldBlurMedia(indexReports(events).byPubkey.get(THEM))).toBe(true);
  });

  it('does not blur when the three disagree about why', () => {
    const events = [
      report({ pubkey: reporter(1), tags: [['p', THEM, 'nudity']] }),
      report({ pubkey: reporter(2), tags: [['p', THEM, 'spam']] }),
      report({ pubkey: reporter(3), tags: [['p', THEM, 'illegal']] }),
    ];

    expect(shouldBlurMedia(indexReports(events).byPubkey.get(THEM))).toBe(false);
  });

  it('does not blur an account because three of its posts were reported', () => {
    /**
     * The NIP is specific about what earns this: "if 3+ of your friends report
     * a *profile* for nudity". Three reports of three separate posts are three
     * claims about three posts, and covering everything the author has ever
     * posted on that basis is a much larger response than any of them asked
     * for. Each of those posts still comes up covered — see below.
     */
    const events = [1, 2, 3].map((n) =>
      report({
        id: String(n).repeat(64),
        pubkey: reporter(n),
        tags: [
          ['p', THEM],
          ['e', String(n).repeat(64), 'nudity'],
        ],
      })
    );

    const index = indexReports(events);

    expect(shouldBlurMedia(index.byPubkey.get(THEM))).toBe(false);
    // The account is still known to have been reported
    expect(index.byPubkey.get(THEM)?.counts.nudity).toBe(3);
  });

  it('still blurs the one post three followed accounts reported', () => {
    const events = [1, 2, 3].map((n) =>
      report({
        id: String(n).repeat(64),
        pubkey: reporter(n),
        tags: [
          ['p', THEM],
          ['e', NOTE, 'nudity'],
        ],
      })
    );

    expect(shouldBlurMedia(indexReports(events).byEvent.get(NOTE))).toBe(true);
  });

  it('leaves the reader out as a target', () => {
    const events = [1, 2, 3].map((n) =>
      report({ id: String(n).repeat(64), pubkey: reporter(n) })
    );

    const index = indexReports(events, { viewer: THEM });
    expect(index.byPubkey.size).toBe(0);
  });

  it('indexes by note and by blob as well as by account', () => {
    const index = indexReports([
      report({
        tags: [
          ['p', THEM, 'malware'],
          ['e', NOTE, 'malware'],
          ['x', HASH, 'malware'],
        ],
      }),
    ]);

    expect(index.byEvent.get(NOTE)?.counts.malware).toBe(1);
    expect(index.byBlob.get(HASH)?.counts.malware).toBe(1);
  });
});

describe('describeReports', () => {
  it('counts people, not reports', () => {
    const events = [
      report({ id: '1'.repeat(64), pubkey: reporter(1) }),
      report({ id: '2'.repeat(64), pubkey: reporter(1) }),
      report({ id: '3'.repeat(64), pubkey: reporter(2) }),
    ];

    const summary = indexReports(events).byPubkey.get(THEM)!;
    expect(describeReports(summary)).toBe(
      '2 people you follow reported this as nudity or sexual content.'
    );
  });
});
