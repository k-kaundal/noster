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

  it('refuses a receipt from the wrong provider where it would buy something', () => {
    /**
     * The check that matters, in the place it matters. Without it anybody can
     * publish a kind 9735 naming any note and any amount, and buy a place in
     * a ranking for the price of an event.
     */
    const summary = summarizeZaps(
      [receipt({ signWith: impostorKey, bolt11: invoice('10m') })],
      { ...target, providerPolicy: 'require' }
    );

    expect(summary.count).toBe(0);
    expect(summary.totalSats).toBe(0);
    // Counted as refused rather than silently dropped, so "I paid and it
    // is not showing" has an answer
    expect(summary.rejected.map((r) => r.reason)).toEqual(['wrong-provider']);
  });

  it('counts it anyway on a note, and says it could not be verified', () => {
    /*
     * The provider key is the one input this app has to guess — remembered
     * from payments made in this browser, missing for most of the network,
     * stale for some of the rest. Letting a guess delete a payment from the
     * screen is the wrong way round, and it happened repeatedly: a key cached
     * from one pay link refused every receipt from its neighbours.
     */
    const summary = summarizeZaps(
      [receipt({ signWith: impostorKey, bolt11: invoice('10m') })],
      target
    );

    expect(summary.count).toBe(1);
    expect(summary.totalSats).toBe(1_000_000);
    expect(summary.unverified).toBe(1);
    expect(summary.rejected).toEqual([]);
  });

  it('still refuses a receipt that fails a check about itself', () => {
    // Only the provider comparison is downgraded. Everything else is a fact
    // about the receipt, not a guess about the world.
    const summary = summarizeZaps([receipt({})], {
      ...target,
      eventId: 'a'.repeat(64),
    });

    expect(summary.count).toBe(0);
    expect(summary.unverified).toBe(0);
    expect(summary.rejected.map((r) => r.reason)).toEqual(['wrong-target']);
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

  it('reports how many receipts arrived, whatever became of them', () => {
    /*
     * The denominator, and the thing the app could not previously see. A
     * receipt that was refused and a receipt that never arrived look identical
     * from the total alone, and they have entirely different causes — one is a
     * validation bug, the other a relay that was not asked. Comparing this
     * against the relay's own NIP-45 count separates them.
     */
    const summary = summarizeZaps(
      [
        receipt({ senderKey: aliceKey }),
        receipt({ senderKey: bobKey, recipient: 'f'.repeat(64) }),
      ],
      target
    );

    expect(summary.count).toBe(1);
    expect(summary.rejected).toHaveLength(1);
    expect(summary.received).toBe(2);
  });

  it('counts a refused receipt once however many relays returned it', () => {
    /*
     * Deduplication used to happen only on acceptance, so a single refused
     * receipt arriving from four relays was listed four times — turning
     * "1 zap not counted" into "4 zaps not counted" on a well-connected
     * client, and pointing at a problem four times bigger than the real one.
     */
    const wrong = receipt({ recipient: 'f'.repeat(64) });

    const summary = summarizeZaps([wrong, wrong, wrong, wrong], target);

    expect(summary.rejected).toHaveLength(1);
    expect(summary.received).toBe(1);
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

  /**
   * A NIP-75 goal is funded by zaps that may name either the goal itself or
   * the note announcing it — the goal is not a thing most clients will zap,
   * and the note is what people actually see.
   */
  describe('several acceptable events', () => {
    const GOAL = 'f'.repeat(64);

    it('counts a zap that named the goal and one that named the note', () => {
      const summary = summarizeZaps(
        [
          receipt({ senderKey: aliceKey, eventId: GOAL, bolt11: ONE_K }),
          receipt({ senderKey: bobKey, eventId: NOTE, bolt11: FIVE_HUNDRED }),
        ],
        {
          eventId: [GOAL, NOTE],
          recipientPubkey: AUTHOR,
          providerPubkey: PROVIDER,
        }
      );

      expect(summary.totalSats).toBe(1_500);
      expect(summary.count).toBe(2);
    });

    it('still refuses a zap that named neither', () => {
      const summary = summarizeZaps(
        [receipt({ senderKey: aliceKey, eventId: 'b'.repeat(64) })],
        {
          eventId: [GOAL, NOTE],
          recipientPubkey: AUTHOR,
          providerPubkey: PROVIDER,
        }
      );

      expect(summary.count).toBe(0);
      expect(summary.totalSats).toBe(0);
      // Counted as refused rather than silently dropped, so "I paid and it
      // is not showing" has an answer
      expect(summary.rejected.map((r) => r.reason)).toEqual(['wrong-target']);
    });

    it('counts a zap to any of several acceptable recipients', () => {
      // A goal can redirect its money to beneficiaries with `zap` tags, and
      // the receipt then names one of them rather than the goal's author
      const BENEFICIARY = 'e'.repeat(64);

      const summary = summarizeZaps(
        [receipt({ senderKey: aliceKey, recipient: BENEFICIARY })],
        {
          eventId: NOTE,
          recipientPubkey: [AUTHOR, BENEFICIARY],
          providerPubkey: PROVIDER,
        }
      );

      expect(summary.totalSats).toBe(1_000);
    });

    it('accepts nothing when the list of acceptable recipients is empty', () => {
      // An empty list is "none of these", not "anybody" — a goal that somehow
      // named no recipient must not count every receipt on the note
      const summary = summarizeZaps([receipt({ senderKey: aliceKey })], {
        eventId: NOTE,
        recipientPubkey: [],
        providerPubkey: PROVIDER,
      });

      expect(summary.count).toBe(0);
      expect(summary.totalSats).toBe(0);
      // Counted as refused rather than silently dropped, so "I paid and it
      // is not showing" has an answer
      expect(summary.rejected.map((r) => r.reason)).toEqual(['wrong-recipient']);
    });
  });
});

describe('describeZapSummary', () => {
  it('gives both numbers, since they answer different questions', () => {
    // One big zap and twelve small ones say very different things, and a
    // total alone cannot tell them apart
    expect(
      describeZapSummary({ totalSats: 3_420, count: 12, zappers: [], unverified: 0, rejected: [], received: 12 })
    ).toBe('3,420 sats · 12 zaps');
  });

  it('does not say "1 zaps"', () => {
    expect(describeZapSummary({ totalSats: 21, count: 1, zappers: [], unverified: 0, rejected: [], received: 1 })).toBe(
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
