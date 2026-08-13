import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { parseZapReceipt, satsFromBolt11, validateZapReceipt } from './zap';

/**
 * Real signatures throughout.
 *
 * This function decides whether money is counted. Every check in it exists to
 * stop somebody inflating a number readers judge a post by, and every check
 * that is too strict silently deletes a payment somebody actually made — so
 * both directions are worth testing against events that were really signed.
 */
const providerKey = generateSecretKey();
const PROVIDER = getPublicKey(providerKey);

const impostorKey = generateSecretKey();
const senderKey = generateSecretKey();

const AUTHOR = 'c'.repeat(64);
const NOTE = 'd'.repeat(64);
const OTHER = 'e'.repeat(64);

/** 1,000 sats, at a length the bolt11 reader accepts. */
const INVOICE_1K = `lnbc10u1p${'q'.repeat(180)}`;
const INVOICE_500 = `lnbc5u1p${'q'.repeat(180)}`;
/** No amount in the prefix, which plenty of real zap flows produce. */
const AMOUNTLESS = `lnbc1p${'q'.repeat(180)}`;

function build(
  options: {
    requestTags?: string[][];
    bolt11?: string;
    signWith?: Uint8Array;
    comment?: string;
    omitDescription?: boolean;
  } = {}
): NostrEvent {
  const request = finalizeEvent(
    {
      kind: 9734,
      created_at: 1_700_000_000,
      content: options.comment ?? '',
      tags: options.requestTags ?? [
        ['p', AUTHOR],
        ['e', NOTE],
        ['amount', '1000000'],
      ],
    },
    senderKey
  );

  const tags: string[][] = [
    ['p', AUTHOR],
    ['e', NOTE],
    ['bolt11', options.bolt11 ?? INVOICE_1K],
  ];

  if (!options.omitDescription) tags.push(['description', JSON.stringify(request)]);

  return finalizeEvent(
    { kind: 9735, created_at: 1_700_000_000, content: '', tags },
    options.signWith ?? providerKey
  ) as NostrEvent;
}

const check = {
  eventId: NOTE,
  recipientPubkey: AUTHOR,
  providerPubkey: PROVIDER,
};

describe('satsFromBolt11', () => {
  it('reads the amount out of the prefix', () => {
    expect(satsFromBolt11(INVOICE_1K)).toBe(1_000);
  });

  it('returns null when the invoice states no amount', () => {
    expect(satsFromBolt11(AMOUNTLESS)).toBeNull();
  });
});

describe('validateZapReceipt', () => {
  it('accepts an ordinary receipt', () => {
    expect(validateZapReceipt(build(), check)).toBe(true);
  });

  it('accepts a zap paid against an amountless invoice', () => {
    /**
     * The bug that hid totals. Plenty of zaps are paid against an invoice
     * with no amount in it — the sum was agreed with the LNURL endpoint —
     * and an amount that cannot be read is an unknown, not a mismatch.
     * Rejecting these dropped real payments silently, so a post showed no
     * total while its author watched the sats arrive.
     */
    expect(validateZapReceipt(build({ bolt11: AMOUNTLESS }), check)).toBe(true);
  });

  it('accepts a zap on a note that mentions somebody', () => {
    /**
     * The other half of the same bug. Clients copy the mentioned pubkeys from
     * the note into the zap request, so the recipient is often not the first
     * `p` tag — and reading only the first threw away every zap on a note
     * with a mention in it.
     */
    const receipt = build({
      requestTags: [
        ['p', OTHER],
        ['p', AUTHOR],
        ['e', NOTE],
        ['amount', '1000000'],
      ],
    });

    expect(validateZapReceipt(receipt, check)).toBe(true);
  });

  it('accepts a zap on a reply, which references its root as well', () => {
    const receipt = build({
      requestTags: [
        ['p', AUTHOR],
        ['e', 'f'.repeat(64)],
        ['e', NOTE],
        ['amount', '1000000'],
      ],
    });

    expect(validateZapReceipt(receipt, check)).toBe(true);
  });

  it('refuses a receipt signed by anyone but the provider', () => {
    // The one check that actually prevents forgery
    expect(validateZapReceipt(build({ signWith: impostorKey }), check)).toBe(
      false
    );
  });

  it('refuses a receipt whose invoice contradicts the amount claimed', () => {
    // Otherwise a receipt advertises 1,000 sats on a 500-sat invoice
    expect(validateZapReceipt(build({ bolt11: INVOICE_500 }), check)).toBe(
      false
    );
  });

  it('refuses a receipt about a different note', () => {
    const receipt = build({
      requestTags: [['p', AUTHOR], ['e', 'f'.repeat(64)], ['amount', '1000000']],
    });

    expect(validateZapReceipt(receipt, check)).toBe(false);
  });

  it('refuses a receipt paid to somebody else', () => {
    const receipt = build({
      requestTags: [['p', OTHER], ['e', NOTE], ['amount', '1000000']],
    });

    expect(validateZapReceipt(receipt, check)).toBe(false);
  });

  it('refuses a receipt with no request in it', () => {
    expect(validateZapReceipt(build({ omitDescription: true }), check)).toBe(
      false
    );
  });

  it('refuses a request the named sender never signed', () => {
    const receipt = build();
    const tampered: NostrEvent = {
      ...receipt,
      tags: receipt.tags.map(([name, value]) =>
        name === 'description'
          ? [
              name,
              JSON.stringify({
                ...JSON.parse(value),
                sig: 'f'.repeat(128),
              }),
            ]
          : [name, value]
      ),
    };

    // Re-signed by the provider so only the inner signature is wrong
    const resigned = finalizeEvent(
      {
        kind: 9735,
        created_at: tampered.created_at,
        content: '',
        tags: tampered.tags,
      },
      providerKey
    ) as NostrEvent;

    expect(validateZapReceipt(resigned, check)).toBe(false);
  });

  it('refuses anything that is not a zap receipt', () => {
    const note = finalizeEvent(
      { kind: 1, created_at: 1, content: 'hi', tags: [] },
      providerKey
    ) as NostrEvent;

    expect(validateZapReceipt(note, check)).toBe(false);
  });
});

describe('parseZapReceipt', () => {
  it('credits the sender rather than the lightning server', () => {
    const parsed = parseZapReceipt(build());

    expect(parsed.senderPubkey).toBe(getPublicKey(senderKey));
    expect(parsed.amountSats).toBe(1_000);
  });

  it('falls back to the requested amount when the invoice states none', () => {
    expect(parseZapReceipt(build({ bolt11: AMOUNTLESS })).amountSats).toBe(
      1_000
    );
  });

  it('keeps the message', () => {
    expect(parseZapReceipt(build({ comment: '  nice one  ' })).comment).toBe(
      'nice one'
    );
  });
});
