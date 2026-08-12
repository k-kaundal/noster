import { describe, it, expect, beforeEach } from 'vitest';
import {
  LAWALLET_MAX_USERNAME,
  LaWalletError,
  acceptsPayments,
  addressesForPubkey,
  isExpectedDenial,
  isDuplicateInvoice,
  readInvoice,
  readStoredInvoice,
  readVerification,
  readWalletAddress,
  unwrapRecord,
  isMissingUser,
  isQuoteStale,
  recallQuote,
  rememberQuote,
  forgetQuote,
  QUOTE_FRESH_MS,
  refusalReason,
  sessionLifetimeMs,
  unwrapList,
  invoiceAmountSats,
  mergeHeldAddresses,
  requiresPayment,
  describeMode,
  isLive,
  laWalletAddress,
  resolveIssuedDomain,
  suggestLaWalletName,
  validateLaWalletName,
  type WalletAddress,
} from './lawallet';

function address(overrides: Partial<WalletAddress> = {}): WalletAddress {
  return { username: 'alice', mode: 'IDLE', ...overrides };
}

describe('validateLaWalletName', () => {
  it('accepts lowercase letters and numbers', () => {
    expect(validateLaWalletName('alice99')).toBeNull();
  });

  it('rejects the punctuation our own addresses allow', () => {
    // Our LNbits addresses take dots, dashes and underscores; this service
    // does not, and finding that out from a 400 is a poor way to learn it
    for (const name of ['first.last', 'first-last', 'first_last']) {
      expect(validateLaWalletName(name)).toBe('invalid-characters');
    }
  });

  it('rejects capitals and spaces', () => {
    expect(validateLaWalletName('Alice')).toBe('invalid-characters');
    expect(validateLaWalletName('al ice')).toBe('invalid-characters');
  });

  it('enforces the length limit', () => {
    expect(validateLaWalletName('a'.repeat(LAWALLET_MAX_USERNAME))).toBeNull();
    expect(validateLaWalletName('a'.repeat(LAWALLET_MAX_USERNAME + 1))).toBe(
      'too-long'
    );
  });

  it('rejects nothing at all', () => {
    expect(validateLaWalletName('')).toBe('empty');
  });
});

describe('suggestLaWalletName', () => {
  it('folds a name down to what the service accepts', () => {
    expect(suggestLaWalletName('First.Last')).toBe('firstlast');
    expect(suggestLaWalletName('José Ruiz')).toBe('joseruiz');
  });

  it('truncates rather than producing something that will be refused', () => {
    expect(suggestLaWalletName('a'.repeat(40))).toHaveLength(
      LAWALLET_MAX_USERNAME
    );
  });

  it('can end up with nothing, which the caller has to handle', () => {
    expect(suggestLaWalletName('日本語')).toBe('');
  });
});

describe('laWalletAddress', () => {
  it('builds the address from the configured domain', () => {
    expect(laWalletAddress('alice')).toMatch(/^alice@/);
  });

  it('issues at the address domain, not the API host', () => {
    // The platform is wallet.nostrfeed.com and hands out @getzap.me; deriving
    // one from the other printed an address that resolves nowhere
    expect(laWalletAddress('kk')).toBe('kk@getzap.me');
  });

  it('takes a domain the service reported', () => {
    expect(laWalletAddress('kk', 'example.com')).toBe('kk@example.com');
  });
});

describe('addressesForPubkey', () => {
  const records = [
    { username: 'kk', pubkey: 'ABC', domain: 'getzap.me' },
    { username: 'someone', pubkey: 'def', domain: 'getzap.me' },
    { username: 'unclaimed', pubkey: null, domain: 'getzap.me' },
  ];

  it('finds the addresses linked to a key', () => {
    expect(addressesForPubkey(records, 'abc')).toEqual([records[0]]);
  });

  it('never matches an address with no key on it', () => {
    // A null pubkey compared loosely would hand every unclaimed name on the
    // platform to whoever signed in
    expect(addressesForPubkey(records, '')).toEqual([]);
    expect(addressesForPubkey(records, undefined)).toEqual([]);
  });

  it('returns nothing for a key that holds nothing', () => {
    expect(addressesForPubkey(records, 'ffff')).toEqual([]);
  });
});

describe('resolveIssuedDomain', () => {
  it('believes the service over our configuration', () => {
    expect(
      resolveIssuedDomain([{ username: 'kk', domain: 'newdomain.me' }])
    ).toBe('newdomain.me');
  });

  it('falls back when the service says nothing', () => {
    expect(resolveIssuedDomain([], 'getzap.me')).toBe('getzap.me');
    expect(resolveIssuedDomain([{ username: 'kk' }], 'getzap.me')).toBe(
      'getzap.me'
    );
    expect(
      resolveIssuedDomain([{ username: 'kk', domain: '  ' }], 'getzap.me')
    ).toBe('getzap.me');
  });
});

describe('mergeHeldAddresses', () => {
  const managed: WalletAddress[] = [
    { username: 'kk', mode: 'ALIAS', redirect: 'me@x.com' },
  ];

  it('keeps the settings of an address the service manages for us', () => {
    const [held] = mergeHeldAddresses(managed, []);
    expect(held.settings?.mode).toBe('ALIAS');
    expect(held.address).toBe('kk@getzap.me');
  });

  it('discovers an address linked to the key but absent from our own list', () => {
    // The case this exists for: somebody already has an address here, and
    // being offered a fresh one as though they had none is how they end up
    // with two
    const held = mergeHeldAddresses([], [
      { username: 'kk', pubkey: 'abc', domain: 'getzap.me' },
    ]);

    expect(held).toHaveLength(1);
    expect(held[0].address).toBe('kk@getzap.me');
    // Nothing is known about where it points, and pretending otherwise would
    // put an editor on screen whose every save fails
    expect(held[0].settings).toBeNull();
  });

  it('does not list an address twice when both sources have it', () => {
    const held = mergeHeldAddresses(managed, [
      { username: 'kk', pubkey: 'abc', domain: 'getzap.me' },
    ]);

    expect(held).toHaveLength(1);
    expect(held[0].settings?.mode).toBe('ALIAS');
  });

  it('uses the domain the directory reported for every address', () => {
    const held = mergeHeldAddresses(managed, [
      { username: 'other', pubkey: 'abc', domain: 'newdomain.me' },
    ]);

    expect(held.map((entry) => entry.address)).toEqual([
      'kk@newdomain.me',
      'other@newdomain.me',
    ]);
  });

  it('ignores a blank username rather than issuing `@getzap.me`', () => {
    expect(mergeHeldAddresses([], [{ username: '  ' }])).toEqual([]);
  });
});

describe('describeMode', () => {
  it('names the destination of an alias', () => {
    expect(
      describeMode(address({ mode: 'ALIAS', redirect: 'me@getalby.com' }))
    ).toContain('me@getalby.com');
  });

  it('mentions the zap receipts a proxy alias adds', () => {
    // The whole reason to choose the proxy over a plain alias
    expect(
      describeMode(address({ mode: 'PROXY_ALIAS', redirect: 'me@x.com' }))
    ).toMatch(/zap receipts/i);
  });

  it('says a connected wallet pays it', () => {
    expect(describeMode(address({ mode: 'CUSTOM_NWC' }))).toMatch(/connected/i);
  });

  it('warns that an unpointed address refuses payments', () => {
    // IDLE resolves and then declines, which looks like a working address
    // right up until someone tries to pay it
    expect(describeMode(address())).toMatch(/refuse/i);
  });
});

describe('isLive', () => {
  it('needs a destination for an alias', () => {
    expect(isLive(address({ mode: 'ALIAS' }))).toBe(false);
    expect(isLive(address({ mode: 'ALIAS', redirect: 'me@x.com' }))).toBe(true);
  });

  it('needs a wallet for a custom NWC address', () => {
    expect(isLive(address({ mode: 'CUSTOM_NWC' }))).toBe(false);
    expect(isLive(address({ mode: 'CUSTOM_NWC', remoteWalletId: 'w1' }))).toBe(
      true
    );
  });

  it('is never live while idle', () => {
    expect(isLive(address({ mode: 'IDLE' }))).toBe(false);
  });
});

describe('requiresPayment', () => {
  const fail = (status: number, message = 'nope', code?: string) =>
    new LaWalletError(message, status, code);

  it('reads 402 as a price', () => {
    expect(requiresPayment(fail(402))).toBe(true);
  });

  it('reads an explicit code', () => {
    expect(requiresPayment(fail(400, 'nope', 'PAYMENT_REQUIRED'))).toBe(true);
  });

  it('reads a refusal that says to pay', () => {
    expect(requiresPayment(fail(400, 'An invoice must be paid first'))).toBe(true);
    expect(requiresPayment(fail(403, 'Purchase required for this name'))).toBe(true);
  });

  it('does not read a taken name as a price', () => {
    // Sending someone to a payment screen because a name was taken is worse
    // than the error it replaced — they would pay for nothing
    expect(requiresPayment(fail(409, 'That name is already taken'))).toBe(false);
    expect(requiresPayment(fail(400, 'Invalid username'))).toBe(false);
  });

  it('does not read an auth or server failure as a price', () => {
    expect(requiresPayment(fail(401, 'Sign in again'))).toBe(false);
    expect(requiresPayment(fail(500, 'Unhandled server error'))).toBe(false);
  });

  it('ignores errors from somewhere else entirely', () => {
    expect(requiresPayment(new Error('payment failed'))).toBe(false);
    expect(requiresPayment(undefined)).toBe(false);
  });
});

describe('invoiceAmountSats', () => {
  it('reads the common multipliers', () => {
    // 100 sats is 1 microBTC; 1000 sats is 10u; 0.001 BTC is 1m
    expect(invoiceAmountSats('lnbc1u1p3xyz')).toBe(100);
    expect(invoiceAmountSats('lnbc10u1p3xyz')).toBe(1000);
    expect(invoiceAmountSats('lnbc1m1p3xyz')).toBe(100_000);
    expect(invoiceAmountSats('lnbc100n1p3xyz')).toBe(10);
  });

  it('reads a whole-bitcoin invoice, whose amount precedes the separator', () => {
    // `lnbc11p3...` is amount `1` then the separator `1`
    expect(invoiceAmountSats('lnbc11p3xyz')).toBe(100_000_000);
  });

  it('handles testnet and regtest prefixes', () => {
    expect(invoiceAmountSats('lntb1u1p3xyz')).toBe(100);
    expect(invoiceAmountSats('lnbcrt1u1p3xyz')).toBe(100);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(invoiceAmountSats('  LNBC1U1P3XYZ ')).toBe(100);
  });

  it('says nothing for an amountless invoice, rather than reading the separator', () => {
    // `lnbc1p3...` carries no amount — that `1` is the bech32 separator.
    // Reading it as a figure offers to pay one whole bitcoin
    expect(invoiceAmountSats('lnbc1p3xyz')).toBeNull();
    expect(invoiceAmountSats('lntb1p3xyz')).toBeNull();
    expect(invoiceAmountSats('not an invoice')).toBeNull();
    expect(invoiceAmountSats('')).toBeNull();
  });
});

describe('unwrapList', () => {
  it('reads the bare array the service actually returns', () => {
    // The schema documents `{ data: [...] }` and the service answers with a
    // plain array. Reading only the documented shape found nothing every time
    // and reported it as "you have no addresses", which is indistinguishable
    // from the truth and so went unnoticed
    expect(unwrapList<number>([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('still reads the documented envelope', () => {
    expect(unwrapList<number>({ data: [1, 2] })).toEqual([1, 2]);
  });

  it('gives an empty list for anything else', () => {
    expect(unwrapList(null)).toEqual([]);
    expect(unwrapList(undefined)).toEqual([]);
    expect(unwrapList({})).toEqual([]);
    expect(unwrapList({ data: 'nope' })).toEqual([]);
  });
});

describe('acceptsPayments', () => {
  it('believes an address that reports no trouble', () => {
    expect(acceptsPayments({ username: 'kk' })).toBe(true);
    expect(
      acceptsPayments({
        username: 'kk',
        protocols: { source: 'wallet', protocols: { lud16: true } },
      })
    ).toBe(true);
  });

  it('catches one that resolves and then refuses', () => {
    // From outside this is indistinguishable from a working address right up
    // until somebody sends money to it
    const disabled = {
      username: 'admin',
      protocols: {
        source: 'unavailable',
        reason: 'This address is disabled and rejects payments.',
        protocols: { lud16: false },
      },
    };

    expect(acceptsPayments(disabled)).toBe(false);
    expect(refusalReason(disabled)).toMatch(/disabled/i);
  });

  it('has something to say even when the service gives no reason', () => {
    expect(
      refusalReason({ username: 'x', protocols: { source: 'unavailable' } })
    ).toBeTruthy();
  });

  it('says nothing about an address that works', () => {
    expect(refusalReason({ username: 'kk' })).toBeNull();
  });
});

describe('mergeHeldAddresses with real directory records', () => {
  it('manages an address the account list never mentioned', () => {
    // The directory returns mode, destination and primary flag as well as the
    // key, so one found only there is fully editable rather than a dead name
    const [held] = mergeHeldAddresses([], [
      {
        username: 'kk',
        pubkey: 'abc',
        mode: 'CUSTOM_NWC',
        remoteWalletId: 'w1',
        isPrimary: true,
      },
    ]);

    expect(held.settings?.mode).toBe('CUSTOM_NWC');
    expect(held.settings?.remoteWalletId).toBe('w1');
    expect(held.isPrimary).toBe(true);
  });

  it('puts the primary address first', () => {
    // Someone can hold dozens; the one their money arrives at belongs on top
    const held = mergeHeldAddresses([], [
      { username: 'zap', pubkey: 'abc', mode: 'IDLE' },
      { username: 'kk', pubkey: 'abc', mode: 'IDLE', isPrimary: true },
      { username: 'admin', pubkey: 'abc', mode: 'IDLE' },
    ]);

    expect(held.map((entry) => entry.username)).toEqual(['kk', 'admin', 'zap']);
  });

  it('carries the refusal through', () => {
    const [held] = mergeHeldAddresses([], [
      {
        username: 'admin',
        pubkey: 'abc',
        mode: 'IDLE',
        protocols: { source: 'unavailable', reason: 'Disabled.' },
      },
    ]);

    expect(held.refusal).toBe('Disabled.');
  });
});

describe('isExpectedDenial', () => {
  const fail = (status: number, code?: string) =>
    new LaWalletError('nope', status, code);

  it('reads "no account here yet" as an ordinary state', () => {
    expect(isExpectedDenial(fail(404))).toBe(true);
    expect(isExpectedDenial(fail(400, 'NOT_FOUND'))).toBe(true);
  });

  it('reads a role this person does not hold as an ordinary state', () => {
    // GET /api/lightning-addresses is marked VIEWER, so it refuses every
    // ordinary user by design — a permanent, expected answer rather than a
    // failure to retry on every mount
    expect(isExpectedDenial(fail(403))).toBe(true);
    expect(isExpectedDenial(fail(403, 'AUTHORIZATION_ERROR'))).toBe(true);
  });

  it('still reports a signature that did not verify', () => {
    // Hiding a 401 behind an empty list turns "sign in again" into "you have
    // nothing", which is the wrong thing to tell somebody
    expect(isExpectedDenial(fail(401))).toBe(false);
  });

  it('still reports a server failure', () => {
    expect(isExpectedDenial(fail(500))).toBe(false);
    expect(isExpectedDenial(new Error('offline'))).toBe(false);
    expect(isExpectedDenial(undefined)).toBe(false);
  });
});

describe('isMissingUser', () => {
  /** The exact envelope the service answers a claim with, for a fresh key. */
  const noUser = new LaWalletError('User not found', 404, 'NOT_FOUND');

  it('recognises the refusal that means "register this key first"', () => {
    expect(isMissingUser(noUser)).toBe(true);
  });

  it('recognises the same thing when the auth chain catches it', () => {
    /**
     * The chain looks up the User row before anything else, so a key with no
     * row is turned away as though it had not signed — a 401 carrying the
     * same sentence as the handler's 404.
     */
    expect(
      isMissingUser(
        new LaWalletError('User not found', 401, 'AUTHENTICATION_ERROR')
      )
    ).toBe(true);
  });

  it('does not read a missing address as a missing user', () => {
    /**
     * Both come back as NOT_FOUND and they want opposite handling: one is
     * fixed by calling `GET /api/users/me` and trying again, the other is
     * fixed by nothing and would spend a signature finding that out.
     */
    expect(
      isMissingUser(new LaWalletError('Address not found', 404, 'NOT_FOUND'))
    ).toBe(false);
  });

  it('ignores anything that is not that refusal', () => {
    // No code at all: a bare 401 is a signature that did not verify
    expect(isMissingUser(new LaWalletError('User not found', 401))).toBe(false);
    expect(isMissingUser(new Error('User not found'))).toBe(false);
    expect(isMissingUser(undefined)).toBe(false);
  });

  it('is read as an ordinary state by the query guard', () => {
    // Otherwise every read fails, and a failed query has nothing to go stale,
    // so all of them refetch on every mount
    expect(isExpectedDenial(noUser)).toBe(true);
    expect(
      isExpectedDenial(
        new LaWalletError('User not found', 401, 'AUTHENTICATION_ERROR')
      )
    ).toBe(true);
  });
});

describe('sessionLifetimeMs', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');

  it('stops short of the real expiry', () => {
    /**
     * A token that expires mid-request is indistinguishable from one that was
     * never valid, and recovering from that costs a signer prompt nobody
     * asked for.
     */
    const life = sessionLifetimeMs(
      { token: 't', expiresAt: '2026-01-01T01:00:00Z' },
      now
    );

    expect(life).toBe(60 * 60_000 - 60_000);
  });

  it('falls back to the schema default when no expiry is reported', () => {
    expect(sessionLifetimeMs({ token: 't' }, now)).toBe(60 * 60_000 - 60_000);
    expect(sessionLifetimeMs({ token: 't', expiresAt: 'soon' }, now)).toBe(
      60 * 60_000 - 60_000
    );
  });

  it('never answers with a negative lifetime', () => {
    expect(
      sessionLifetimeMs({ token: 't', expiresAt: '2025-01-01T00:00:00Z' }, now)
    ).toBe(0);
  });
});

describe('isDuplicateInvoice', () => {
  /** The exact body the service answers a second invoice request with. */
  const collision = new LaWalletError(
    'The wallet service hit an error on its side.',
    500,
    'INTERNAL_SERVER_ERROR',
    '\nInvalid `prisma.invoice.create()` invocation:\n\n\nUnique constraint failed on the fields: (`paymentHash`)'
  );

  it('recognises the collision behind the generic 500', () => {
    /**
     * The code is the same INTERNAL_SERVER_ERROR every unhandled failure
     * carries, so the detail is the only thing that tells this apart — and
     * the detail is precisely what must not be shown to anyone.
     */
    expect(isDuplicateInvoice(collision)).toBe(true);
  });

  it('does not fire on other server failures', () => {
    expect(
      isDuplicateInvoice(
        new LaWalletError('...', 500, 'INTERNAL_SERVER_ERROR', 'ECONNREFUSED')
      )
    ).toBe(false);

    // A unique-constraint failure on something else is a different problem
    expect(
      isDuplicateInvoice(
        new LaWalletError(
          '...',
          500,
          'INTERNAL_SERVER_ERROR',
          'Unique constraint failed on the fields: (`username`)'
        )
      )
    ).toBe(false);
  });

  it('ignores errors carrying no detail at all', () => {
    expect(isDuplicateInvoice(new LaWalletError('boom', 500))).toBe(false);
    expect(isDuplicateInvoice(new Error('boom'))).toBe(false);
  });
});

describe('the held-invoice store', () => {
  const invoice = {
    id: 'inv_1',
    purpose: 'wallet-address' as const,
    pr: 'lnbc10u1pabc',
    paymentHash: 'abc',
    settled: false,
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('gives back the invoice it was handed', () => {
    rememberQuote('pub', 'alice', invoice, 1000);

    const held = recallQuote('pub', 'alice');

    // Normalised on the way out, so it carries a derived amount the stored
    // record did not have — the payment request and id are what must survive
    expect(held?.issuedAt).toBe(1000);
    expect(held?.invoice.pr).toBe(invoice.pr);
    expect(held?.invoice.id).toBe(invoice.id);
  });

  it('keeps one key\'s invoices away from another\'s', () => {
    rememberQuote('pub', 'alice', invoice);

    expect(recallQuote('other', 'alice')).toBeNull();
  });

  it('matches the name however it was capitalised', () => {
    rememberQuote('pub', 'Alice', invoice);

    expect(recallQuote('pub', 'alice')?.invoice.id).toBe(invoice.id);
  });

  it('forgets one without disturbing the rest', () => {
    rememberQuote('pub', 'alice', invoice);
    rememberQuote('pub', 'bob', invoice);

    forgetQuote('pub', 'alice');

    expect(recallQuote('pub', 'alice')).toBeNull();
    expect(recallQuote('pub', 'bob')).not.toBeNull();
  });

  it('survives storage holding something that is not JSON', () => {
    localStorage.setItem('lawallet:quotes', 'not json');

    expect(recallQuote('pub', 'alice')).toBeNull();
  });
});

describe('isQuoteStale', () => {
  const quote = {
    invoice: {
      id: 'inv_1',
      purpose: 'wallet-address' as const,
      pr: 'lnbc',
      paymentHash: 'abc',
      settled: false,
    },
    issuedAt: 1_000_000,
  };

  it('is fresh well inside the window', () => {
    expect(isQuoteStale(quote, quote.issuedAt + 60_000)).toBe(false);
  });

  it('goes stale before a BOLT11 would normally expire', () => {
    /**
     * Early on purpose. Being early costs one request; being late offers an
     * invoice the wallet rejects, which reads as the payment failing rather
     * than as the bill being old.
     */
    expect(QUOTE_FRESH_MS).toBeLessThan(60 * 60_000);
    expect(isQuoteStale(quote, quote.issuedAt + QUOTE_FRESH_MS + 1)).toBe(true);
  });
});

/** Captured from a real POST /api/invoices, exactly as it came back. */
const LIVE_INVOICE = {
  id: '12527fd0-168f-48ac-bbfd-0deeb0cde74c',
  bolt11:
    'lnbc50u1p48et3wpp5unt7uf8f2zkk49flc2nwlg23m6ms3gl265wvechpj025jt35lpsqcqzyssp5sj3um0x452r5aaa360le2kvem6244lcgmy57n7mg0qek9vjtc3xq9q7sqqqqqqqqqqqqqqqqqqqsqqqqqysgqhp5ztsfewjuxp7fcxmk8hynk8x8r2sllnkczzyytpklg7wvplwkj26smqz9gxqrrssrzjqwryaup9lh50kkranzgcdnn2fgvx390wgj5jd07rwr3vxeje0glclllc9ma0u3h3ksqqqqlgqqqqqeqqjq99c79llj9hcd0x3ethaax0pcmnr4a3empdymdn5qvffm0a4mefs5wcfdwdj434sm6sxjuw9ukz02gjva7z8evw3k3rzw4jwcnf3y5sqpag3c0s',
  paymentHash:
    'e4d7ee24e950ad6a953fc2a6efa151deb708a3ead51ccce2e193d5492e34f860',
  amountSats: 5000,
  verify:
    'https://getzap.me/api/lud16/kk/verify/e4d7ee24e950ad6a953fc2a6efa151deb708a3ead51ccce2e193d5492e34f860',
  expiresAt: '2026-08-12T17:42:31.034Z',
};

describe('readInvoice', () => {
  it('reads the payment request the service actually sends', () => {
    /**
     * The schema calls this field `pr`. The service calls it `bolt11`.
     * Reading only the documented name left it undefined all the way to
     * `.trim()`, which is how a field-name mismatch reached somebody buying a
     * name as "Cannot read properties of undefined".
     */
    expect(readInvoice(LIVE_INVOICE).pr).toBe(LIVE_INVOICE.bolt11);
  });

  it('keeps the amount the service stated rather than re-deriving it', () => {
    const invoice = readInvoice(LIVE_INVOICE);

    expect(invoice.amountSats).toBe(5000);
    // And it agrees with the invoice itself — lnbc50u is 0.00005 BTC
    expect(invoiceAmountSats(LIVE_INVOICE.bolt11)).toBe(5000);
  });

  it('carries the id, hash and expiry through', () => {
    const invoice = readInvoice(LIVE_INVOICE);

    expect(invoice.id).toBe(LIVE_INVOICE.id);
    expect(invoice.paymentHash).toBe(LIVE_INVOICE.paymentHash);
    expect(invoice.expiresAt).toBe(LIVE_INVOICE.expiresAt);
  });

  it('keeps the verify URL, which is what allows paying from elsewhere', () => {
    /**
     * Claiming needs the preimage and an outside wallet never hands one to a
     * web page. Losing this field would quietly reduce the payment options
     * back to "a wallet connected here".
     */
    expect(readInvoice(LIVE_INVOICE).verify).toBe(LIVE_INVOICE.verify);
  });

  it('still reads the field name the schema documents', () => {
    const invoice = readInvoice({ id: 'a', pr: 'lnbc10u1pabc', settled: false });

    expect(invoice.pr).toBe('lnbc10u1pabc');
    // Derived, since this shape states no amount
    expect(invoice.amountSats).toBe(1000);
  });

  it('unwraps a record that arrives inside an envelope', () => {
    expect(readInvoice({ data: LIVE_INVOICE }).id).toBe(LIVE_INVOICE.id);
  });

  it('refuses an invoice with nothing to pay', () => {
    expect(() => readInvoice({ id: 'a' })).toThrow(/nothing to pay/i);
    expect(() => readInvoice(null)).toThrow(/nothing to pay/i);
  });

  it('refuses an invoice that could never be claimed', () => {
    /**
     * Claiming is POST /api/invoices/{id}/claim, so one with no id can be
     * paid and then proves nothing — worth stopping before the money moves.
     */
    expect(() => readInvoice({ bolt11: 'lnbc10u1pabc' })).toThrow(/no id/i);
  });
});

describe('readStoredInvoice', () => {
  it('rescues an invoice saved before bolt11 was understood', () => {
    // The payment request was always in the record, under a name nothing read
    expect(readStoredInvoice(LIVE_INVOICE)?.pr).toBe(LIVE_INVOICE.bolt11);
  });

  it('answers null for a stored record that cannot be read', () => {
    expect(readStoredInvoice({ id: 'a' })).toBeNull();
    expect(readStoredInvoice(undefined)).toBeNull();
  });
});

describe('unwrapRecord', () => {
  it('takes the envelope off when there is one', () => {
    expect(unwrapRecord({ data: { id: 'a' } })).toEqual({ id: 'a' });
  });

  it('leaves a bare record alone', () => {
    expect(unwrapRecord({ id: 'a' })).toEqual({ id: 'a' });
  });

  it('does not mistake a list or a scalar for a record', () => {
    expect(unwrapRecord([{ id: 'a' }])).toEqual({});
    expect(unwrapRecord('nope')).toEqual({});
    expect(unwrapRecord(null)).toEqual({});
  });

  it('leaves a record whose own data field is not an object', () => {
    expect(unwrapRecord({ data: 'x', id: 'a' })).toEqual({ data: 'x', id: 'a' });
  });
});

describe('readWalletAddress', () => {
  it('falls back to the name that was asked for', () => {
    // Otherwise the success toast says "undefined is yours"
    expect(readWalletAddress({}, 'premium').username).toBe('premium');
  });

  it('prefers what the service returned', () => {
    expect(readWalletAddress({ username: 'alice' }, 'premium').username).toBe(
      'alice'
    );
  });

  it('defaults an unusable mode rather than carrying it', () => {
    expect(readWalletAddress({ mode: 42 }, 'premium').mode).toBe('IDLE');
  });
});

describe('readVerification', () => {
  it('reads a settled LUD-21 response', () => {
    expect(
      readVerification({ status: 'OK', settled: true, preimage: 'abc123' })
    ).toEqual({ settled: true, preimage: 'abc123' });
  });

  it('reads one that has not been paid yet', () => {
    expect(
      readVerification({ status: 'OK', settled: false, preimage: null })
    ).toEqual({ settled: false, preimage: undefined });
  });

  it('takes a preimage as proof on its own', () => {
    /**
     * LUD-21 holds the preimage back until the payment settles, so its
     * presence cannot mean anything else — and an implementation that returns
     * one without setting `settled` should not cost somebody their name.
     */
    expect(readVerification({ preimage: 'abc123' }).settled).toBe(true);
  });

  it('does not read an unpaid invoice as paid', () => {
    // The direction that matters: a false positive claims a name that was
    // never paid for, and the claim fails with the money already gone
    expect(readVerification({ status: 'ERROR' }).settled).toBe(false);
    expect(readVerification({}).settled).toBe(false);
    expect(readVerification(null).settled).toBe(false);
    expect(readVerification({ settled: 'true' }).settled).toBe(false);
  });
});
