import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  MIN_FINGERPRINT_LENGTH,
  contentFingerprint,
  findCampaigns,
  isBlankProfile,
  judgeSpam,
  partitionSpam,
} from './campaignSpam';

const ME = 'm'.repeat(64);
const FRIEND = 'f'.repeat(64);

/** The message from the actual incident, verbatim. */
const ADVERT =
  'I built a sovereign, zero-KYC developer stack - metadata stripping, ephemeral vaults, fingerprint protection, NIP-05 resolution. All BTC-gated, no BS. Free tier available: https://ash-dev.pages.dev';

let counter = 0;

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  counter += 1;

  return {
    id: `event-${counter}`,
    pubkey: `bot-${counter}`.padEnd(64, '0'),
    kind: 1,
    content: ADVERT,
    tags: [['e', 'note']],
    created_at: 1_700_000_000,
    sig: '',
    ...overrides,
  };
}

describe('contentFingerprint', () => {
  it('ignores the parts a bot varies between sends', () => {
    /**
     * Swapping a tracking parameter is the cheapest possible mutation, so the
     * URL cannot be part of what is matched on.
     */
    const a = contentFingerprint('Free tier: https://ash-dev.pages.dev?ref=1');
    const b = contentFingerprint('Free tier: https://ash-dev.pages.dev?ref=2');

    expect(a).toBe(b);
  });

  it('ignores case, punctuation and spacing', () => {
    expect(contentFingerprint('Hello,   WORLD!!')).toBe(
      contentFingerprint('hello world')
    );
  });

  it('keeps the sentence somebody wrote', () => {
    expect(contentFingerprint('Zero-KYC developer stack')).toBe(
      'zero kyc developer stack'
    );
  });

  it('still tells different messages apart', () => {
    expect(contentFingerprint('good morning')).not.toBe(
      contentFingerprint('good evening')
    );
  });
});

describe('findCampaigns', () => {
  it('catches the same message from several accounts', () => {
    // The attack every per-author check passes: one post each, seconds apart
    const campaigns = findCampaigns([
      event({ created_at: 1_700_000_000 }),
      event({ created_at: 1_700_000_030 }),
      event({ created_at: 1_700_000_045 }),
    ]);

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].authors.size).toBe(3);
  });

  it('leaves one person repeating themselves alone', () => {
    /**
     * A habit, not a script. Somebody posting their own link twice is a
     * question for the per-author checks, and filtering it here would hide
     * half of anybody who cross-posts.
     */
    const author = 'a'.repeat(64);

    const campaigns = findCampaigns([
      event({ pubkey: author }),
      event({ pubkey: author, created_at: 1_700_000_600 }),
    ]);

    expect(campaigns).toEqual([]);
  });

  it('ignores messages too short to mean anything', () => {
    // "gm" from a thousand people is a greeting, not a campaign
    const campaigns = findCampaigns([
      event({ content: 'gm' }),
      event({ content: 'gm' }),
      event({ content: 'gm' }),
    ]);

    expect(campaigns).toEqual([]);
    expect(MIN_FINGERPRINT_LENGTH).toBeGreaterThan(2);
  });

  it('does not join sends that are months apart', () => {
    const campaigns = findCampaigns([
      event({ created_at: 1_700_000_000 }),
      event({ created_at: 1_700_000_000 + 90 * 86_400 }),
    ]);

    expect(campaigns).toEqual([]);
  });
});

describe('isBlankProfile', () => {
  it('spots a profile nobody filled in', () => {
    expect(isBlankProfile(undefined)).toBe(true);
    expect(isBlankProfile({})).toBe(true);
    expect(isBlankProfile({ name: '   ' })).toBe(true);
  });

  it('accepts any one real field as effort', () => {
    expect(isBlankProfile({ name: 'alice' })).toBe(false);
    expect(isBlankProfile({ picture: 'https://example.com/a.jpg' })).toBe(false);
  });
});

describe('judgeSpam', () => {
  const following = new Set([FRIEND]);

  it('flags the campaign', () => {
    const verdicts = judgeSpam(
      [event(), event(), event()],
      { following, self: ME }
    );

    expect(verdicts).toHaveLength(3);
    expect(verdicts[0].reasons).toContain('campaign');
  });

  it('never filters somebody the reader follows', () => {
    /**
     * The rule that costs the most to get wrong. A false positive here loses
     * a real message from a real friend, which is worse than any amount of
     * spam getting through.
     */
    const verdicts = judgeSpam(
      [event({ pubkey: FRIEND }), event(), event()],
      { following, self: ME }
    );

    expect(verdicts.map((verdict) => verdict.event.pubkey)).not.toContain(
      FRIEND
    );
  });

  it('never filters the reader themselves', () => {
    const verdicts = judgeSpam(
      [event({ pubkey: ME }), event(), event()],
      { following, self: ME }
    );

    expect(verdicts.map((verdict) => verdict.event.pubkey)).not.toContain(ME);
  });

  it('flags a blank stranger posting a link', () => {
    const stranger = event({ content: 'check this out https://example.com' });
    const profiles = new Map([[stranger.pubkey, {}]]);

    const verdicts = judgeSpam([stranger], { following, self: ME }, profiles);

    expect(verdicts[0]?.reasons).toContain('anonymous-link');
  });

  it('waits for the profile rather than assuming a missing one is blank', () => {
    /**
     * An author whose kind 0 has not arrived is unknown, not blank. Treating
     * the two alike would filter every stranger with a link for as long as
     * the profile query is in flight, which is most of a cold start.
     */
    const stranger = event({ content: 'check this out https://example.com' });

    expect(judgeSpam([stranger], { following, self: ME })).toEqual([]);
  });

  it('leaves a blank stranger alone when they post no link', () => {
    // Plenty of real people never fill in a profile; an empty one is not guilt
    const stranger = event({ content: 'welcome to nostr, glad you are here' });
    const profiles = new Map([[stranger.pubkey, {}]]);

    expect(judgeSpam([stranger], { following, self: ME }, profiles)).toEqual([]);
  });

  it('leaves a stranger alone once they have a profile', () => {
    const stranger = event({ content: 'my site https://example.com' });
    const profiles = new Map([[stranger.pubkey, { name: 'alice' }]]);

    expect(judgeSpam([stranger], { following, self: ME }, profiles)).toEqual([]);
  });

  it('exempts a friend-of-a-friend from the profile rule but not the campaign', () => {
    const vouchedKey = 'v'.repeat(64);
    const context = {
      following,
      extended: new Set([vouchedKey]),
      self: ME,
    };

    const vouchedEvent = event({
      pubkey: vouchedKey,
      content: 'a link https://example.com',
    });

    const linkOnly = judgeSpam([vouchedEvent], context, new Map([[vouchedKey, {}]]));
    expect(linkOnly).toEqual([]);

    // A bought account can be followed by another bought account, so the
    // campaign rule still applies
    const inCampaign = judgeSpam(
      [event({ pubkey: vouchedKey }), event(), event()],
      context
    );
    expect(
      inCampaign.map((verdict) => verdict.event.pubkey)
    ).toContain(vouchedKey);
  });
});

describe('partitionSpam', () => {
  it('hands back what it held, rather than dropping it', () => {
    /**
     * A filter nobody can inspect is indistinguishable from a bug, and the
     * one message this gets wrong is the one the reader most needs to find.
     */
    const items = [
      { id: 'a', event: event() },
      { id: 'b', event: event() },
      { id: 'c', event: event({ pubkey: FRIEND }) },
    ];

    const result = partitionSpam(items, (item) => item.event, {
      following: new Set([FRIEND]),
      self: ME,
    });

    expect(result.kept.map((item) => item.id)).toEqual(['c']);
    expect(result.filtered.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.reasons.get(items[0].event.id)).toContain('campaign');
  });

  it('keeps everything when there is nothing wrong', () => {
    const items = [
      { id: 'a', event: event({ content: 'a perfectly ordinary reply here' }) },
    ];

    const result = partitionSpam(items, (item) => item.event, {
      following: new Set(),
      self: ME,
    });

    expect(result.filtered).toEqual([]);
    expect(result.kept).toHaveLength(1);
  });
});
