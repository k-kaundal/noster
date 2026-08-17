import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  explainZapReceipt,
  parseZapReceipt,
  satsFromBolt11,
  validateZapReceipt,
} from './zap';

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

describe('profile zaps', () => {
  /**
   * The shape our own client sends when the profile page's zap button is used
   * — taken verbatim from a real one, minus the signature. `p`, `amount`,
   * `relays`, `lnurl`, and nothing pointing at any event.
   */
  const profileRequestTags = [
    ['relays', 'wss://relay.primal.net', 'wss://relay.nostr.band'],
    ['amount', '1000000'],
    ['p', AUTHOR],
    ['lnurl', 'lnurl1dp68gurn8ghj7'],
  ];

  it('accepts a receipt with no event tag', () => {
    expect(
      validateZapReceipt(build({ requestTags: profileRequestTags }), {
        recipientPubkey: AUTHOR,
        providerPubkey: PROVIDER,
        profileOnly: true,
      })
    ).toBe(true);
  });

  it('rejects a note zap, which also names the author with p', () => {
    // Otherwise a profile total is the sum of everything its owner was ever
    // paid, rather than what was sent to them directly
    expect(
      validateZapReceipt(build(), {
        recipientPubkey: AUTHOR,
        providerPubkey: PROVIDER,
        profileOnly: true,
      })
    ).toBe(false);
  });

  it('rejects an article zap for the same reason', () => {
    expect(
      validateZapReceipt(
        build({
          requestTags: [
            ['p', AUTHOR],
            ['a', `30023:${AUTHOR}:x`],
            ['amount', '1000000'],
          ],
        }),
        {
          recipientPubkey: AUTHOR,
          providerPubkey: PROVIDER,
          profileOnly: true,
        }
      )
    ).toBe(false);
  });

  it('still checks who was paid', () => {
    expect(
      validateZapReceipt(build({ requestTags: profileRequestTags }), {
        recipientPubkey: OTHER,
        providerPubkey: PROVIDER,
        profileOnly: true,
      })
    ).toBe(false);
  });

  it('still checks the signing server', () => {
    expect(
      validateZapReceipt(
        build({ requestTags: profileRequestTags, signWith: impostorKey }),
        {
          recipientPubkey: AUTHOR,
          providerPubkey: PROVIDER,
          profileOnly: true,
        }
      )
    ).toBe(false);
  });

  it('was invisible before: no event id matches one', () => {
    // The old question, asked of the new shape — this is the state the profile
    // page was in, counting zero however many arrived
    expect(
      validateZapReceipt(build({ requestTags: profileRequestTags }), {
        eventId: NOTE,
        recipientPubkey: AUTHOR,
        providerPubkey: PROVIDER,
      })
    ).toBe(false);
  });
});

describe('explainZapReceipt names the failing check', () => {
  it('accepts a receipt that passes everything', () => {
    expect(explainZapReceipt(build(), check)).toBeNull();
  });

  it('names a provider mismatch', () => {
    /*
     * The reason this is a name rather than `false`: a server that rotated its
     * signing key produces exactly this, and so does a forgery. Telling them
     * apart used to mean reading the validator and guessing which line ran.
     */
    expect(
      explainZapReceipt(build(), { ...check, providerPubkey: OTHER })
    ).toBe('wrong-provider');
  });

  it('accepts any key the server has been seen using', () => {
    // A rotation does not make last month's zaps forgeries
    expect(
      explainZapReceipt(build(), { ...check, providerPubkey: [OTHER, PROVIDER] })
    ).toBeNull();
  });

  it('names a target mismatch', () => {
    expect(explainZapReceipt(build(), { ...check, eventId: OTHER })).toBe(
      'wrong-target'
    );
  });

  it('names a recipient mismatch', () => {
    expect(
      explainZapReceipt(build(), { ...check, recipientPubkey: OTHER })
    ).toBe('wrong-recipient');
  });

  it('names a receipt with nothing to check', () => {
    expect(explainZapReceipt(build({ omitDescription: true }), check)).toBe(
      'missing-description'
    );
  });

  it('names an event that is not a receipt at all', () => {
    expect(explainZapReceipt({ ...build(), kind: 1 }, check)).toBe(
      'not-a-receipt'
    );
  });

  it('names a request somebody else signed', () => {
    expect(
      explainZapReceipt(build({ signWith: impostorKey }), {
        ...check,
        providerPubkey: undefined,
      })
    ).toBeNull();
  });
});
