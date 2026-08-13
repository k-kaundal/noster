import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  NO_SUBSCRIPTION,
  TIER_KIND,
  buildTierTags,
  cadenceSeconds,
  needsRenewal,
  parseTier,
  rankTiers,
  subscriptionStatus,
  tierAddress,
} from './subscription';

const creatorKey = generateSecretKey();
const CREATOR = getPublicKey(creatorKey);

/**
 * The creator's own lightning server signs the receipts, so its key is what
 * makes a subscription unforgeable — the same check zap totals rest on.
 */
const providerKey = generateSecretKey();

const subscriberKey = generateSecretKey();
const SUBSCRIBER = getPublicKey(subscriberKey);

const strangerKey = generateSecretKey();

const NOW = 1_700_000_000;
const DAY = 86_400;

function tierEvent(overrides: { tags?: string[][] } = {}): NostrEvent {
  return finalizeEvent(
    {
      kind: TIER_KIND,
      created_at: NOW,
      content: '',
      tags: overrides.tags ?? [
        ['d', 'gold'],
        ['title', 'Gold'],
        ['amount', '5000', 'monthly'],
        ['description', 'Everything, early'],
        ['perks', 'Early access', 'Direct messages'],
      ],
    },
    creatorKey
  ) as NostrEvent;
}

const TIER = {
  creator: CREATOR,
  slug: 'gold',
  amount: 5_000,
  cadence: 'monthly' as const,
};

/** A bolt11 the amount parser will read. */
function invoice(prefix: string): string {
  return `lnbc${prefix}1p${'q'.repeat(180)}`;
}

/** A subscription payment: a zap to the tier's coordinate. */
function payment(options: {
  at?: number;
  bolt11?: string;
  from?: Uint8Array;
  address?: string;
}): NostrEvent {
  const at = options.at ?? NOW;
  const address = options.address ?? tierAddress(TIER);

  const request = finalizeEvent(
    {
      kind: 9734,
      created_at: at,
      content: '',
      tags: [['p', CREATOR], ['a', address]],
    },
    options.from ?? subscriberKey
  );

  return finalizeEvent(
    {
      kind: 9735,
      created_at: at,
      content: '',
      tags: [
        ['p', CREATOR],
        ['a', address],
        ['bolt11', options.bolt11 ?? invoice('50u')],
        ['description', JSON.stringify(request)],
      ],
    },
    providerKey
  ) as NostrEvent;
}

describe('parseTier', () => {
  it('reads a tier', () => {
    const tier = parseTier(tierEvent());

    expect(tier).toMatchObject({
      slug: 'gold',
      title: 'Gold',
      amount: 5_000,
      cadence: 'monthly',
    });
    expect(tier?.perks).toEqual(['Early access', 'Direct messages']);
  });

  it('refuses a tier nobody can pay', () => {
    /**
     * The amount becomes an invoice. A tier priced at nothing, or at half a
     * sat, is a subscribe button that cannot be pressed.
     */
    expect(parseTier(tierEvent({ tags: [['d', 'x'], ['amount', '0']] }))).toBeNull();
    expect(parseTier(tierEvent({ tags: [['d', 'x'], ['amount', '0.5']] }))).toBeNull();
    expect(parseTier(tierEvent({ tags: [['d', 'x']] }))).toBeNull();
  });

  it('refuses a tier with no identifier', () => {
    expect(parseTier(tierEvent({ tags: [['amount', '1000']] }))).toBeNull();
  });

  it('defaults an unknown period to monthly rather than dropping the tier', () => {
    const tier = parseTier(
      tierEvent({ tags: [['d', 'x'], ['amount', '1000', 'fortnightly']] })
    );

    expect(tier?.cadence).toBe('monthly');
  });
});

describe('buildTierTags', () => {
  it('carries an alt line, since most clients have never seen this kind', () => {
    const tags = buildTierTags({
      slug: 'gold',
      title: 'Gold',
      description: '',
      amount: 5_000,
      cadence: 'monthly',
      perks: [],
    });

    expect(tags.find(([name]) => name === 'alt')?.[1]).toContain('5000 sats');
  });

  it('round-trips through the parser', () => {
    const draft = {
      slug: 'silver',
      title: 'Silver',
      description: 'Nice things',
      amount: 2_100,
      cadence: 'yearly' as const,
      perks: ['A postcard'],
    };

    const event = finalizeEvent(
      { kind: TIER_KIND, created_at: NOW, content: '', tags: buildTierTags(draft) },
      creatorKey
    ) as NostrEvent;

    expect(parseTier(event)).toMatchObject(draft);
  });

  it('drops blank perks rather than publishing empty lines', () => {
    const tags = buildTierTags({
      slug: 'x',
      title: 'X',
      description: '',
      amount: 1,
      cadence: 'monthly',
      perks: ['  ', ''],
    });

    expect(tags.find(([name]) => name === 'perks')).toBeUndefined();
  });
});

describe('subscriptionStatus', () => {
  it('is active inside the period a payment bought', () => {
    const status = subscriptionStatus([payment({ at: NOW - 5 * DAY })], {
      tier: TIER,
      subscriber: SUBSCRIBER,
      now: NOW,
    });

    expect(status.state).toBe('active');
    expect(status.daysLeft).toBe(25);
  });

  it('lapses once the period runs out', () => {
    const status = subscriptionStatus([payment({ at: NOW - 40 * DAY })], {
      tier: TIER,
      subscriber: SUBSCRIBER,
      now: NOW,
    });

    expect(status.state).toBe('lapsed');
    expect(status.daysLeft).toBe(0);
  });

  it('is nothing for somebody who never paid', () => {
    expect(
      subscriptionStatus([], { tier: TIER, subscriber: SUBSCRIBER, now: NOW })
    ).toEqual(NO_SUBSCRIPTION);
  });

  it('does not grant a period for less than the price', () => {
    /**
     * Somebody sending 500 sats towards a 5,000 sat tier has tipped, and has
     * not bought a month. Quietly granting one would make the price a
     * suggestion.
     */
    const status = subscriptionStatus([payment({ bolt11: invoice('5u') })], {
      tier: TIER,
      subscriber: SUBSCRIBER,
      now: NOW,
    });

    expect(status.state).toBe('none');
    // Their money was still real, so it is still on the record
    expect(status.history).toHaveLength(1);
    expect(status.totalSats).toBe(500);
  });

  it('keeps a period open when a small tip follows a full payment', () => {
    // The newest payment is not always the one that bought the period
    const status = subscriptionStatus(
      [
        payment({ at: NOW - 10 * DAY }),
        payment({ at: NOW - 1 * DAY, bolt11: invoice('1u') }),
      ],
      { tier: TIER, subscriber: SUBSCRIBER, now: NOW }
    );

    expect(status.state).toBe('active');
    expect(status.daysLeft).toBe(20);
  });

  it('ignores somebody else’s payments', () => {
    const status = subscriptionStatus([payment({ from: strangerKey })], {
      tier: TIER,
      subscriber: SUBSCRIBER,
      now: NOW,
    });

    expect(status.state).toBe('none');
  });

  it('ignores payments to a different tier', () => {
    const status = subscriptionStatus(
      [payment({ address: `${TIER_KIND}:${CREATOR}:bronze` })],
      { tier: TIER, subscriber: SUBSCRIBER, now: NOW }
    );

    expect(status.state).toBe('none');
  });

  it('adds up everything they have ever paid on it', () => {
    const status = subscriptionStatus(
      [payment({ at: NOW - 5 * DAY }), payment({ at: NOW - 40 * DAY })],
      { tier: TIER, subscriber: SUBSCRIBER, now: NOW }
    );

    expect(status.totalSats).toBe(10_000);
    expect(status.history).toHaveLength(2);
  });

  it('counts a yearly tier as a year', () => {
    const status = subscriptionStatus([payment({ at: NOW - 40 * DAY })], {
      tier: { ...TIER, cadence: 'yearly' },
      subscriber: SUBSCRIBER,
      now: NOW,
    });

    expect(status.state).toBe('active');
    expect(cadenceSeconds('yearly')).toBe(365 * DAY);
  });
});

describe('needsRenewal', () => {
  it('is true once a period has lapsed', () => {
    const status = subscriptionStatus([payment({ at: NOW - 40 * DAY })], {
      tier: TIER,
      subscriber: SUBSCRIBER,
      now: NOW,
    });

    expect(needsRenewal(status)).toBe(true);
  });

  it('warns before the end rather than after it', () => {
    const status = subscriptionStatus([payment({ at: NOW - 28 * DAY })], {
      tier: TIER,
      subscriber: SUBSCRIBER,
      now: NOW,
    });

    expect(status.state).toBe('active');
    expect(needsRenewal(status)).toBe(true);
  });

  it('says nothing mid-period', () => {
    const status = subscriptionStatus([payment({ at: NOW - 2 * DAY })], {
      tier: TIER,
      subscriber: SUBSCRIBER,
      now: NOW,
    });

    expect(needsRenewal(status)).toBe(false);
  });
});

describe('rankTiers', () => {
  it('orders by price, cheapest first', () => {
    const bronze = finalizeEvent(
      {
        kind: TIER_KIND,
        created_at: NOW,
        content: '',
        tags: [['d', 'bronze'], ['amount', '1000', 'monthly']],
      },
      creatorKey
    ) as NostrEvent;

    expect(rankTiers([tierEvent(), bronze]).map((tier) => tier.slug)).toEqual([
      'bronze',
      'gold',
    ]);
  });

  it('keeps only the newest revision of a tier', () => {
    /**
     * A tier is addressable, so an edited one comes back twice from relays
     * holding both revisions — and showing an old price beside a new one is
     * how somebody pays the wrong amount.
     */
    const older = finalizeEvent(
      {
        kind: TIER_KIND,
        created_at: NOW - 1000,
        content: '',
        tags: [['d', 'gold'], ['amount', '9000', 'monthly']],
      },
      creatorKey
    ) as NostrEvent;

    const tiers = rankTiers([older, tierEvent()]);

    expect(tiers).toHaveLength(1);
    expect(tiers[0].amount).toBe(5_000);
  });

  it('drops anything that is not a usable tier', () => {
    const junk = finalizeEvent(
      { kind: 1, created_at: NOW, content: 'hi', tags: [] },
      creatorKey
    ) as NostrEvent;

    expect(rankTiers([junk])).toEqual([]);
  });
});
