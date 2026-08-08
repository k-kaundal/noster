import { describe, it, expect } from 'vitest';
import {
  buildCallbackUrl,
  parsePayMetadata,
  readLnurlError,
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
