import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  BOOST_TIERS,
  MAX_MULTIPLIER,
  activeBoosts,
  isActive,
  placeBoosted,
  readBoost,
  tierForAmount,
  type Boost,
} from './boost';
import { toMsat } from './money';

/**
 * Real keys and real signatures.
 *
 * The whole claim this module makes is that a boost cannot be forged, and
 * that claim rests on signature checks. Testing it with hand-written objects
 * that skip those checks would test the shape of the code and nothing about
 * what it is for.
 */
const providerKey = generateSecretKey();
const PROVIDER = getPublicKey(providerKey);

const payerKey = generateSecretKey();
const PAYER = getPublicKey(payerKey);

const impostorKey = generateSecretKey();

const PLATFORM = 'f'.repeat(64);
const NOTE = 'a'.repeat(64);

/**
 * A bolt11 long enough to be read.
 *
 * The amount lives in the human-readable prefix, and the parser refuses
 * anything under fifty characters — so the padding is real, and deliberately
 * contains no `1`, which is the separator the prefix ends at.
 */
function invoice(amount: string): string {
  return `lnbc${amount}1p${'q'.repeat(60)}`;
}

const INVOICE_1K = invoice('10u');
const INVOICE_5K = invoice('50u');
const INVOICE_TINY = invoice('10n');

function zapRequest(
  overrides: { tags?: string[][]; key?: Uint8Array } = {}
): NostrEvent {
  return finalizeEvent(
    {
      kind: 9734,
      created_at: 1_700_000_000,
      content: '',
      tags: overrides.tags ?? [
        ['p', PLATFORM],
        ['e', NOTE],
        ['relays', 'wss://relay.example'],
      ],
    },
    overrides.key ?? payerKey
  ) as NostrEvent;
}

function receipt(
  overrides: {
    request?: NostrEvent;
    bolt11?: string;
    key?: Uint8Array;
    createdAt?: number;
    tags?: string[][];
  } = {}
): NostrEvent {
  const request = overrides.request ?? zapRequest();

  return finalizeEvent(
    {
      kind: 9735,
      created_at: overrides.createdAt ?? 1_700_000_000,
      content: '',
      tags: overrides.tags ?? [
        ['p', PLATFORM],
        ['e', NOTE],
        ['bolt11', overrides.bolt11 ?? INVOICE_1K],
        ['description', JSON.stringify(request)],
      ],
    },
    overrides.key ?? providerKey
  ) as NostrEvent;
}

const source = { platformPubkey: PLATFORM, providerPubkey: PROVIDER };

describe('tierForAmount', () => {
  it('buys the largest tier the payment covers', () => {
    expect(tierForAmount(toMsat(1_000))?.code).toBe('starter');
    expect(tierForAmount(toMsat(5_000))?.code).toBe('growth');
    expect(tierForAmount(toMsat(9_999))?.code).toBe('growth');
    expect(tierForAmount(toMsat(10_000))?.code).toBe('pro');
  });

  it('buys nothing below the cheapest tier', () => {
    expect(tierForAmount(toMsat(999))).toBeNull();
    expect(tierForAmount(0)).toBeNull();
  });

  it('caps what any amount can buy', () => {
    // Somebody sending a million sats gets a longer look at the same ceiling
    // everybody else has. The cap is the point.
    const huge = tierForAmount(toMsat(10_000_000));

    expect(huge?.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(MAX_MULTIPLIER).toBeLessThanOrEqual(3);
  });
});

describe('readBoost', () => {
  it('reads a paid boost from a valid receipt', () => {
    const boost = readBoost(receipt(), source);

    expect(boost).toMatchObject({
      noteId: NOTE,
      payerPubkey: PAYER,
      amount: toMsat(1_000),
    });
    expect(boost?.tier.code).toBe('starter');
  });

  it('refuses a receipt signed by anyone but the platform lightning server', () => {
    /**
     * The check the whole design rests on. Without it, anybody can publish a
     * kind 9735 naming their own note and promote themselves for nothing.
     */
    expect(readBoost(receipt({ key: impostorKey }), source)).toBeNull();
  });

  it('refuses a payment addressed to somebody else', () => {
    // An ordinary zap to a creator is not a purchase of promotion from us
    const elsewhere = zapRequest({
      tags: [
        ['p', 'b'.repeat(64)],
        ['e', NOTE],
      ],
    });

    expect(readBoost(receipt({ request: elsewhere }), source)).toBeNull();
  });

  it('refuses a receipt with no note on it', () => {
    const noNote = zapRequest({ tags: [['p', PLATFORM]] });

    expect(readBoost(receipt({ request: noNote }), source)).toBeNull();
  });

  it('refuses a request the named payer never signed', () => {
    // The signature inside the description is what attributes the payment
    const forged = { ...zapRequest(), sig: 'f'.repeat(128) } as NostrEvent;

    expect(readBoost(receipt({ request: forged }), source)).toBeNull();
  });

  it('refuses a payment below the cheapest tier', () => {
    expect(readBoost(receipt({ bolt11: INVOICE_TINY }), source)).toBeNull();
  });

  it('takes the amount from the invoice, not from the request', () => {
    /**
     * The request's `amount` tag is what was asked for; the invoice is what
     * was actually payable. A boost priced from the request would let
     * somebody claim a campaign tier on a starter invoice.
     */
    const boost = readBoost(receipt({ bolt11: INVOICE_5K }), source);

    expect(boost?.amount).toBe(toMsat(5_000));
    expect(boost?.tier.code).toBe('growth');
  });

  it('times the window from the receipt rather than the request', () => {
    // The receipt is signed by the platform, so it is the one timestamp the
    // buyer cannot choose
    const boost = readBoost(receipt({ createdAt: 1_700_009_999 }), source);

    expect(boost?.startedAt).toBe(1_700_009_999);
    expect(boost?.expiresAt).toBe(1_700_009_999 + BOOST_TIERS[0].durationSeconds);
  });

  it('ignores an event that is not a zap receipt at all', () => {
    const note = finalizeEvent(
      { kind: 1, created_at: 1, content: 'hello', tags: [] },
      providerKey
    ) as NostrEvent;

    expect(readBoost(note, source)).toBeNull();
  });
});

function boost(overrides: Partial<Boost> = {}): Boost {
  return {
    receiptId: 'receipt',
    noteId: NOTE,
    payerPubkey: PAYER,
    amount: toMsat(1_000),
    tier: BOOST_TIERS[0],
    startedAt: 1_000,
    expiresAt: 2_000,
    ...overrides,
  };
}

describe('isActive', () => {
  it('runs between its start and its expiry', () => {
    expect(isActive(boost(), 1_500)).toBe(true);
  });

  it('is over once it expires', () => {
    expect(isActive(boost(), 2_000)).toBe(false);
    expect(isActive(boost(), 5_000)).toBe(false);
  });
});

describe('activeBoosts', () => {
  it('does not stack two boosts on one note', () => {
    /**
     * Stacking would let somebody buy past the cap by buying twice, which is
     * the cap not existing. The strongest applies; the rest stay in the
     * public ledger as what they are.
     */
    const result = activeBoosts(
      [
        boost({ receiptId: 'weak', tier: BOOST_TIERS[0] }),
        boost({ receiptId: 'strong', tier: BOOST_TIERS[2] }),
      ],
      1_500
    );

    expect(result).toHaveLength(1);
    expect(result[0].receiptId).toBe('strong');
  });

  it('prefers the longer of two equally strong boosts', () => {
    const result = activeBoosts(
      [
        boost({ receiptId: 'short', expiresAt: 2_000 }),
        boost({ receiptId: 'long', expiresAt: 9_000 }),
      ],
      1_500
    );

    expect(result[0].receiptId).toBe('long');
  });

  it('drops expired ones', () => {
    expect(activeBoosts([boost({ expiresAt: 1_200 })], 1_500)).toEqual([]);
  });

  it('ranks the strongest first', () => {
    const result = activeBoosts(
      [
        boost({ noteId: 'a', tier: BOOST_TIERS[0] }),
        boost({ noteId: 'b', tier: BOOST_TIERS[2] }),
        boost({ noteId: 'c', tier: BOOST_TIERS[1] }),
      ],
      1_500
    );

    expect(result.map((entry) => entry.noteId)).toEqual(['b', 'c', 'a']);
  });
});

describe('placeBoosted', () => {
  const organic = Array.from({ length: 40 }, (_, index) => ({
    id: `organic-${index}`,
  }));

  it('puts one promoted note between runs of organic ones', () => {
    const placed = placeBoosted(organic, [{ id: 'ad-1' }]);

    expect(placed.items[8]).toEqual({ id: 'ad-1' });
    expect(placed.promoted.has('ad-1')).toBe(true);
  });

  it('never lets promotion past a tenth of the feed', () => {
    // A day when everybody boosts at once produces the same feed as a quiet
    // one; the notes that missed out are not shown rather than queued
    const many = Array.from({ length: 50 }, (_, index) => ({
      id: `ad-${index}`,
    }));

    const placed = placeBoosted(organic, many);

    expect(placed.promoted.size).toBeLessThanOrEqual(
      Math.floor(placed.items.length * 0.1)
    );
  });

  it('shows a boosted note once, not twice', () => {
    /**
     * The note being promoted is usually already in the timeline. Showing it
     * in both places is how a reader learns to distrust a feed.
     */
    const placed = placeBoosted(
      [{ id: 'shared' }, ...organic],
      [{ id: 'shared' }]
    );

    const appearances = placed.items.filter((item) => item.id === 'shared');
    expect(appearances).toHaveLength(1);
  });

  it('promotes nothing into a feed too short to hold it', () => {
    const placed = placeBoosted([{ id: 'one' }, { id: 'two' }], [{ id: 'ad' }]);

    expect(placed.promoted.size).toBe(0);
    expect(placed.items.map((item) => item.id)).toEqual(['one', 'two']);
  });

  it('leaves an unboosted feed exactly as it was', () => {
    const placed = placeBoosted(organic, []);

    expect(placed.items).toEqual(organic);
    expect(placed.promoted.size).toBe(0);
  });
});
