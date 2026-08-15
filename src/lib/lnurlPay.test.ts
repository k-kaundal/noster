import { describe, it, expect } from 'vitest';
import {
  buildCallbackUrl,
  parsePayMetadata,
  isUsableCallback,
  readLnurlError,
  readLnurlJson,
  readMetadataDescription,
  validateAmount,
  type LnurlPayMetadata,
} from './lnurlPay';

const metadata: LnurlPayMetadata = {
  callback: 'https://ln.example.com/lnurlp/api/v1/lnurl/cb/abc',
  minSendableMsat: 1_000,
  maxSendableMsat: 100_000_000,
  commentAllowed: 255,
  allowsNostr: true,
  zapCapable: true,
  description: 'Relay access',
};

describe('parsePayMetadata', () => {
  it('reads a well-formed pay request', () => {
    const parsed = parsePayMetadata({
      callback: 'https://x/cb',
      minSendable: 1000,
      maxSendable: 5000,
      commentAllowed: 64,
      allowsNostr: true,
      nostrPubkey: 'a'.repeat(64),
      metadata: '[["text/plain","Relay access"]]',
    });

    expect(parsed?.minSendableMsat).toBe(1000);
    expect(parsed?.commentAllowed).toBe(64);
    expect(parsed?.allowsNostr).toBe(true);
    expect(parsed?.description).toBe('Relay access');
  });

  it('defaults commentAllowed to zero when absent', () => {
    // Absent means the link accepts no comment, not that any length is fine
    const parsed = parsePayMetadata({
      callback: 'https://x/cb',
      minSendable: 1,
      maxSendable: 1,
    });
    expect(parsed?.commentAllowed).toBe(0);
  });

  it('rejects a response with no callback to pay to', () => {
    expect(parsePayMetadata({ minSendable: 1, maxSendable: 1 })).toBeNull();
    expect(parsePayMetadata(null)).toBeNull();
  });

  it('rejects non-numeric amounts rather than producing NaN bounds', () => {
    expect(
      parsePayMetadata({ callback: 'https://x/cb', minSendable: 'lots' })
    ).toBeNull();
  });
});

describe('readMetadataDescription', () => {
  it('pulls the plain text entry out of the blob', () => {
    expect(
      readMetadataDescription('[["text/plain","Monthly access"]]')
    ).toBe('Monthly access');
  });

  it('survives a malformed blob rather than failing the payment', () => {
    expect(readMetadataDescription('not json')).toBe('');
    expect(readMetadataDescription(undefined)).toBe('');
  });
});

describe('zapCapable', () => {
  const base = {
    callback: 'https://x/cb',
    minSendable: 1000,
    maxSendable: 5000,
    metadata: '[["text/plain","x"]]',
  };

  it('trusts a server that advertises both halves', () => {
    const parsed = parsePayMetadata({
      ...base,
      allowsNostr: true,
      nostrPubkey: 'a'.repeat(64),
    });

    expect(parsed?.zapCapable).toBe(true);
  });

  it('refuses a promise with no key behind it', () => {
    /**
     * The LNbits shape, and the reason zaps could vanish without a trace. A
     * pay link with its `zaps` switch on advertises `allowsNostr` straight
     * away, while receipts are published by a separate extension that has to
     * be installed, enabled and connected to relays. Until it is, the invoice
     * is paid and no kind 9735 is ever written — so believing this flag alone
     * meant reporting a zap that would never appear anywhere.
     */
    const parsed = parsePayMetadata({ ...base, allowsNostr: true });

    expect(parsed?.allowsNostr).toBe(true);
    expect(parsed?.zapCapable).toBe(false);
  });

  it('refuses a key that is not a BIP-340 pubkey', () => {
    // NIP-57 step 1 is specific: "a valid BIP 340 public key in hex"
    for (const nostrPubkey of ['', 'not-hex', 'a'.repeat(63), 'z'.repeat(64)]) {
      const parsed = parsePayMetadata({ ...base, allowsNostr: true, nostrPubkey });

      expect(parsed?.zapCapable).toBe(false);
      expect(parsed?.nostrPubkey).toBeUndefined();
    }
  });

  it('refuses a key with no promise in front of it', () => {
    const parsed = parsePayMetadata({ ...base, nostrPubkey: 'a'.repeat(64) });

    expect(parsed?.zapCapable).toBe(false);
  });

  it('normalises the key, which clients compare byte for byte', () => {
    const parsed = parsePayMetadata({
      ...base,
      allowsNostr: true,
      nostrPubkey: 'A'.repeat(64),
    });

    expect(parsed?.nostrPubkey).toBe('a'.repeat(64));
  });
});

describe('buildCallbackUrl', () => {
  it('adds the amount in millisats', () => {
    const url = new URL(buildCallbackUrl(metadata.callback, 21_000));
    expect(url.searchParams.get('amount')).toBe('21000');
  });

  it('keeps query parameters the callback already had', () => {
    // Appending "?amount=" blindly would produce a URL with two ? and fail
    const url = new URL(
      buildCallbackUrl('https://x/cb?id=abc', 1000, 'hello')
    );
    expect(url.searchParams.get('id')).toBe('abc');
    expect(url.searchParams.get('comment')).toBe('hello');
  });

  it('omits the comment when there is none', () => {
    const url = new URL(buildCallbackUrl(metadata.callback, 1000));
    expect(url.searchParams.has('comment')).toBe(false);
  });

  it('rounds a fractional amount, which the protocol cannot carry', () => {
    const url = new URL(buildCallbackUrl(metadata.callback, 1000.6));
    expect(url.searchParams.get('amount')).toBe('1001');
  });
});

describe('readLnurlError', () => {
  it('reads the reason from an error response', () => {
    expect(readLnurlError({ status: 'ERROR', reason: 'Link is spent' })).toBe(
      'Link is spent'
    );
  });

  it('still reports an error with no reason given', () => {
    expect(readLnurlError({ status: 'ERROR' })).toBeTruthy();
  });

  it('returns null for a successful response', () => {
    expect(readLnurlError({ pr: 'lnbc1...' })).toBeNull();
    expect(readLnurlError(null)).toBeNull();
  });
});

describe('validateAmount', () => {
  it('accepts an amount inside the range', () => {
    expect(validateAmount(1000, metadata)).toBeNull();
  });

  it('reports the bounds in sats, not millisats', () => {
    expect(validateAmount(0.5, metadata)).toMatch(/Minimum is 1 sats/);
    expect(validateAmount(200_000, metadata)).toMatch(/Maximum is 100000 sats/);
  });

  it('rejects a missing or negative amount', () => {
    expect(validateAmount(0, metadata)).toBeTruthy();
    expect(validateAmount(-5, metadata)).toBeTruthy();
    expect(validateAmount(NaN, metadata)).toBeTruthy();
  });
});

describe('isUsableCallback', () => {
  it('accepts https', () => {
    expect(isUsableCallback('https://ln.example.com/cb/abc')).toBe(true);
  });

  it('refuses plaintext http', () => {
    // The callback carries the signed zap request and returns the invoice;
    // over http both are readable and the invoice is replaceable in flight
    expect(isUsableCallback('http://ln.example.com/cb/abc')).toBe(false);
  });

  it('allows http for onion services, which encrypt at the transport', () => {
    expect(isUsableCallback('http://abcdefg.onion/cb/abc')).toBe(true);
  });

  it('refuses schemes that are not http at all', () => {
    expect(isUsableCallback('javascript:alert(1)')).toBe(false);
    expect(isUsableCallback('data:text/plain,hi')).toBe(false);
    expect(isUsableCallback('file:///etc/passwd')).toBe(false);
  });

  it('refuses something that is not a URL', () => {
    expect(isUsableCallback('not a url')).toBe(false);
  });
});

describe('parsePayMetadata callback checking', () => {
  it('rejects an offer whose callback is plaintext', () => {
    // A stranger's profile chooses this host, so the offer is attacker-shaped
    // in the ordinary case and refusing beats downgrading the payment
    expect(
      parsePayMetadata({
        callback: 'http://ln.example.com/cb',
        minSendable: 1000,
        maxSendable: 5000,
      })
    ).toBeNull();
  });

  it('accepts the offer our own instance returns', () => {
    const parsed = parsePayMetadata({
      tag: 'payRequest',
      callback: 'https://ln.nostrfeed.com/lnurlp/api/v1/lnurl/cb/3a6b8a',
      minSendable: 1000,
      maxSendable: 10000000000,
      metadata:
        '[["text/plain", "Payment to help"], ["text/identifier", "help@ln.nostrfeed.com"]]',
      commentAllowed: 255,
      allowsNostr: true,
      nostrPubkey:
        'bad5595b406b685a64e997503b61ba1be88b39f20aebb0cf0dc151d17b0bee33',
    });

    expect(parsed?.zapCapable).toBe(true);
    expect(parsed?.commentAllowed).toBe(255);
    expect(parsed?.description).toBe('Payment to help');
  });
});

describe('readLnurlError casing', () => {
  it('reads a rejection however the server capitalised it', () => {
    for (const status of ['ERROR', 'Error', 'error']) {
      expect(readLnurlError({ status, reason: 'Nope' })).toBe('Nope');
    }
  });
});

describe('readLnurlJson', () => {
  const reply = (body: string, init?: ResponseInit) =>
    new Response(body, init);

  it('returns the parsed body of a good reply', async () => {
    await expect(
      readLnurlJson(reply('{"pr":"lnbc1"}'), 'invoice')
    ).resolves.toEqual({ pr: 'lnbc1' });
  });

  it('reports an HTML error page by its status, not as bad JSON', async () => {
    // The ordinary failure: a domain proxying /.well-known/lnurlp/* with no
    // rule for this name answers its own 404 page
    await expect(
      readLnurlJson(reply('<!doctype html><h1>Not Found</h1>', { status: 404 }), 'offer')
    ).rejects.toThrow(/404/);
  });

  it('prefers the reason the server gave over the status', async () => {
    await expect(
      readLnurlJson(
        reply('{"status":"ERROR","reason":"Amount too small"}', { status: 400 }),
        'invoice'
      )
    ).rejects.toThrow('Amount too small');
  });

  it('refuses an empty 200 rather than returning undefined', async () => {
    await expect(readLnurlJson(reply(''), 'offer')).rejects.toThrow(
      /valid reply/
    );
  });
});
