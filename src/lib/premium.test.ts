import { describe, it, expect } from 'vitest';
import {
  buildPaymentComment,
  isFixedPrice,
  parseLinkId,
  payLinkLnurl,
  payLinkUrl,
} from './premium';

const NPUB = 'npub1' + 'q'.repeat(58);

describe('parseLinkId', () => {
  it('pulls the id out of a shared pay link URL', () => {
    expect(parseLinkId('https://ln.nostrfeed.com/lnurlp/link/QxKstJ')).toBe(
      'QxKstJ'
    );
  });

  it('handles the shorter form without /link', () => {
    expect(parseLinkId('https://ln.nostrfeed.com/lnurlp/6yJz7H')).toBe('6yJz7H');
  });

  it('passes a bare id through, so config can hold either', () => {
    expect(parseLinkId('QxKstJ')).toBe('QxKstJ');
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(parseLinkId('  QxKstJ\n')).toBe('QxKstJ');
  });

  it('returns empty for an unset value rather than a broken id', () => {
    expect(parseLinkId('')).toBe('');
    expect(parseLinkId('   ')).toBe('');
  });
});

describe('payLinkLnurl', () => {
  it('builds the lnurlp form from the id', () => {
    // The API's own `lnurl` field is deprecated in favour of constructing this
    expect(payLinkLnurl('QxKstJ')).toMatch(/^lnurlp:\/\//);
    expect(payLinkLnurl('QxKstJ')).toContain('/lnurlp/QxKstJ');
  });

  it('carries no scheme prefix from the base URL', () => {
    expect(payLinkLnurl('QxKstJ')).not.toContain('https://');
  });
});

describe('payLinkUrl', () => {
  it('points at the human-facing page', () => {
    expect(payLinkUrl('QxKstJ')).toMatch(/^https:\/\//);
    expect(payLinkUrl('QxKstJ')).toContain('/lnurlp/link/QxKstJ');
  });
});

describe('buildPaymentComment', () => {
  it('names the buyer and the plan when there is room', () => {
    const comment = buildPaymentComment(NPUB, 'Monthly access', 255);

    expect(comment).toContain(NPUB);
    expect(comment).toContain('Monthly access');
  });

  it('sends nothing when the link accepts no comment', () => {
    // LNbits rejects a comment longer than the link's comment_chars, and a
    // link created with the default of zero accepts none at all
    expect(buildPaymentComment(NPUB, 'Monthly access', 0)).toBe('');
  });

  it('keeps the npub and drops the plan name when space is tight', () => {
    const comment = buildPaymentComment(NPUB, 'Monthly access', NPUB.length);

    expect(comment).toBe(NPUB);
    expect(comment.length).toBeLessThanOrEqual(NPUB.length);
  });

  it('sends nothing rather than a truncated, unusable npub', () => {
    // Half an npub identifies nobody, so it is worse than no comment
    expect(buildPaymentComment(NPUB, 'Monthly access', 20)).toBe('');
  });

  it('never exceeds the limit it was given', () => {
    for (const limit of [0, 10, 63, 64, 100, 255]) {
      expect(
        buildPaymentComment(NPUB, 'Monthly access', limit).length
      ).toBeLessThanOrEqual(limit);
    }
  });
});

describe('isFixedPrice', () => {
  const terms = { commentChars: 255, description: '' };

  it('is fixed when the range has no width', () => {
    expect(isFixedPrice({ ...terms, minSats: 5000, maxSats: 5000 })).toBe(true);
  });

  it('is not fixed when the payer can choose', () => {
    expect(isFixedPrice({ ...terms, minSats: 1, maxSats: 100_000 })).toBe(false);
  });
});
