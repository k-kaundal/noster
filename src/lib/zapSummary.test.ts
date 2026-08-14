import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  EMPTY_ZAP_SUMMARY,
  describeZapSummary,
  summarizeZaps,
} from './zapSummary';

/**
 * Real signatures, because the claim being tested is that a total cannot be
 * inflated by somebody publishing a receipt they had no part in.
 */
const providerKey = generateSecretKey();
const PROVIDER = getPublicKey(providerKey);

const impostorKey = generateSecretKey();

const aliceKey = generateSecretKey();
const ALICE = getPublicKey(aliceKey);

const bobKey = generateSecretKey();
const BOB = getPublicKey(bobKey);

const AUTHOR = 'c'.repeat(64);
const NOTE = 'd'.repeat(64);

/** A bolt11 the parser will read: the amount lives in the prefix. */
function invoice(amount: string): string {
  return `lnbc${amount}1p${'q'.repeat(60)}`;
}

const ONE_K = invoice('10u');
const FIVE_HUNDRED = invoice('5u');

function receipt(options: {
  senderKey?: Uint8Array;
  bolt11?: string;
  comment?: string;
  eventId?: string;
  recipient?: string;
  signWith?: Uint8Array;
  createdAt?: number;
}): NostrEvent {
  const request = finalizeEvent(
    {
      kind: 9734,
      created_at: options.createdAt ?? 1_700_000_000,
      content: options.comment ?? '',
      tags: [
        ['p', options.recipient ?? AUTHOR],
        ['e', options.eventId ?? NOTE],
      ],
    },
    options.senderKey ?? aliceKey
  );

  return finalizeEvent(
    {
      kind: 9735,
      created_at: options.createdAt ?? 1_700_000_000,
      content: '',
      tags: [
        ['p', options.recipient ?? AUTHOR],
        ['e', options.eventId ?? NOTE],
        ['bolt11', options.bolt11 ?? ONE_K],
        ['description', JSON.stringify(request)],
      ],
    },
    options.signWith ?? providerKey
  ) as NostrEvent;
}

const target = {
  eventId: NOTE,
  recipientPubkey: AUTHOR,
  providerPubkey: PROVIDER,
};

describe('summarizeZaps', () => {
  it('adds up what was actually paid', () => {
    const summary = summarizeZaps(
      [
        receipt({ senderKey: aliceKey, bolt11: ONE_K }),
        receipt({ senderKey: bobKey, bolt11: FIVE_HUNDRED }),
      ],
      target
    );

    expect(summary.totalSats).toBe(1_500);
    expect(summary.count).toBe(2);
  });

  it('names the sender, not the lightning server that signed the receipt', () => {
    // Attributing a zap to the receipt author credits a payment processor
    const summary = summarizeZaps([receipt({ senderKey: aliceKey })], target);

    expect(summary.zappers[0].pubkey).toBe(ALICE);
  });

  it('refuses a receipt signed by anyone but the provider', () => {
    /**
     * The check that matters. Without it anybody can publish a kind 9735
     * naming any note and any amount, and inflate the number readers judge a
     * post by.
     */
    const summary = summarizeZaps(
      [receipt({ signWith: impostorKey, bolt11: invoice('10m') })],
      target
    );

    expect(summary).toEqual(EMPTY_ZAP_SUMMARY);
  });

  it('ignores receipts about a different note', () => {
    const summary = summarizeZaps(
      [receipt({ eventId: 'e'.repeat(64) })],
      target
    );

    expect(summary.totalSats).toBe(0);
  });

  it('ignores receipts paid to somebody else', () => {
    const summary = summarizeZaps(
      [receipt({ recipient: 'f'.repeat(64) })],
      target
    );

    expect(summary.totalSats).toBe(0);
  });

  it('counts a receipt once however many relays returned it', () => {
    /**
     * The same receipt arrives from every relay holding it. Counting per copy
     * multiplies a total by however many relays somebody reads from.
     */
    const one = receipt({ senderKey: aliceKey });

    expect(summarizeZaps([one, one, one], target).totalSats).toBe(1_000);
  });

  it('counts two zaps from one person as two', () => {
    // Distinct receipts, not distinct people
    const summary = summarizeZaps(
      [
        receipt({ senderKey: aliceKey, createdAt: 1_700_000_001 }),
        receipt({ senderKey: aliceKey, createdAt: 1_700_000_002 }),
      ],
      target
    );

    expect(summary.count).toBe(2);
    expect(summary.totalSats).toBe(2_000);
  });

  it('keeps the message, which is half the point of a zap', () => {
    const summary = summarizeZaps(
      [receipt({ comment: 'Great post!' })],
      target
    );

    expect(summary.zappers[0].comment).toBe('Great post!');
  });

  it('puts the largest first', () => {
    const summary = summarizeZaps(
      [
        receipt({ senderKey: aliceKey, bolt11: FIVE_HUNDRED }),
        receipt({ senderKey: bobKey, bolt11: ONE_K }),
      ],
      target
    );

    expect(summary.zappers.map((zapper) => zapper.pubkey)).toEqual([BOB, ALICE]);
  });

  it('is empty for a note nobody zapped', () => {
    expect(summarizeZaps([], target)).toEqual(EMPTY_ZAP_SUMMARY);
  });

  it('counts an article zap, which names a coordinate rather than an id', () => {
    /**
     * An addressable event is referenced by `30023:<pubkey>:<d>`, and its zap
     * requests frequently carry no `e` tag at all — so checking them against
     * an event id rejected every one, and an article showed no total however
     * many times it had been paid.
     */
    const address = `30023:${AUTHOR}:my-article`;

    const request = finalizeEvent(
      {
        kind: 9734,
        created_at: 1_700_000_000,
        content: '',
        tags: [['p', AUTHOR], ['a', address], ['amount', '1000000']],
      },
      aliceKey
    );

    const articleReceipt = finalizeEvent(
      {
        kind: 9735,
        created_at: 1_700_000_000,
        content: '',
        tags: [
          ['p', AUTHOR],
          ['a', address],
          ['bolt11', ONE_K],
          ['description', JSON.stringify(request)],
        ],
      },
      providerKey
    ) as NostrEvent;

    const summary = summarizeZaps([articleReceipt], {
      address,
      recipientPubkey: AUTHOR,
      providerPubkey: PROVIDER,
    });

    expect(summary.totalSats).toBe(1_000);
    expect(summary.zappers[0].pubkey).toBe(ALICE);
  });
});

describe('describeZapSummary', () => {
  it('gives both numbers, since they answer different questions', () => {
    // One big zap and twelve small ones say very different things, and a
    // total alone cannot tell them apart
    expect(
      describeZapSummary({ totalSats: 3_420, count: 12, zappers: [] })
    ).toBe('3,420 sats · 12 zaps');
  });

  it('does not say "1 zaps"', () => {
    expect(describeZapSummary({ totalSats: 21, count: 1, zappers: [] })).toBe(
      '21 sats · 1 zap'
    );
  });
});


/**
 * A goal can redirect its money.
 *
 * NIP-75 lets a goal carry `zap` tags naming beneficiaries, and the receipt
 * then names one of those rather than the goal's author. Checking against the
 * author alone rejected every such receipt, so a goal that had really been
 * funded sat at zero with nothing to say why.
 */
describe('summarizeZaps with several acceptable recipients', () => {
  const BENEFICIARY = 'e'.repeat(64);

  it('counts a zap that named a beneficiary rather than the author', () => {
    const paid = receipt({ bolt11: ONE_K, recipient: BENEFICIARY });

    expect(
      summarizeZaps([paid], {
        eventId: NOTE,
        recipientPubkey: [AUTHOR, BENEFICIARY],
      }).totalSats
    ).toBe(1000);
  });

  it('still rejects one that named nobody on the list', () => {
    const elsewhere = receipt({ bolt11: ONE_K, recipient: 'f'.repeat(64) });

    expect(
      summarizeZaps([elsewhere], {
        eventId: NOTE,
        recipientPubkey: [AUTHOR, BENEFICIARY],
      }).totalSats
    ).toBe(0);
  });

  it('takes a single pubkey exactly as before', () => {
    const paid = receipt({ bolt11: ONE_K });

    expect(
      summarizeZaps([paid], { eventId: NOTE, recipientPubkey: AUTHOR })
        .totalSats
    ).toBe(1000);
  });

  it('counts a receipt found on two relays once', () => {
    /**
     * Reading the goal's relays and the reader's own means the same receipt
     * arrives twice, and a total counted per copy is a total doubled.
     */
    const paid = receipt({ bolt11: ONE_K, recipient: BENEFICIARY });

    expect(
      summarizeZaps([paid, paid], {
        eventId: NOTE,
        recipientPubkey: [AUTHOR, BENEFICIARY],
      })
    ).toMatchObject({ totalSats: 1000, count: 1 });
  });
});
