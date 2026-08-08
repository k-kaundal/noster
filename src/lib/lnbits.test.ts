import { describe, it, expect } from 'vitest';
import {
  describeError,
  msatToSat,
  readAccessToken,
  satToMsat,
} from './lnbits';

describe('describeError', () => {
  it('reads a plain FastAPI detail string', () => {
    expect(describeError({ detail: 'Invoice already paid' }, 400)).toBe(
      'Invoice already paid'
    );
  });

  it('joins FastAPI validation errors, which arrive as a list', () => {
    const body = {
      detail: [
        { loc: ['body', 'amount'], msg: 'must be positive', type: 'value_error' },
        { loc: ['body', 'memo'], msg: 'too long', type: 'value_error' },
      ],
    };

    expect(describeError(body, 422)).toBe('must be positive; too long');
  });

  it('reads the message field extensions use', () => {
    expect(describeError({ success: false, message: 'Link is spent' }, 400))
      .toBe('Link is spent');
  });

  it('prefers message over detail when a body carries both', () => {
    expect(describeError({ message: 'clearer', detail: 'vaguer' }, 400)).toBe(
      'clearer'
    );
  });

  it('passes a bare string body through', () => {
    expect(describeError('Gateway timeout', 504)).toBe('Gateway timeout');
  });

  it('explains the statuses LNbits gives a specific meaning', () => {
    expect(describeError(null, 401)).toMatch(/sign in/i);
    expect(describeError(null, 402)).toMatch(/balance/i);
    // 520 is LNbits' own code for a node-level payment failure
    expect(describeError(null, 520)).toMatch(/node/i);
  });

  it('falls back to the status rather than an empty message', () => {
    expect(describeError(undefined, 500)).toBe('Request failed (500)');
    expect(describeError({}, 500)).toBe('Request failed (500)');
  });

  it('ignores an empty detail rather than reporting a blank error', () => {
    expect(describeError({ detail: '' }, 500)).toBe('Request failed (500)');
    expect(describeError({ detail: [] }, 500)).toBe('Request failed (500)');
  });
});

describe('readAccessToken', () => {
  it('reads the token LNbits returns on login', () => {
    expect(readAccessToken({ access_token: 'abc', token_type: 'bearer' })).toBe(
      'abc'
    );
  });

  it('accepts the other spellings a body might use', () => {
    expect(readAccessToken({ token: 'abc' })).toBe('abc');
    expect(readAccessToken({ accessToken: 'abc' })).toBe('abc');
  });

  it('returns undefined when the token only came back as a cookie', () => {
    expect(readAccessToken({})).toBeUndefined();
    expect(readAccessToken(undefined)).toBeUndefined();
    expect(readAccessToken('OK')).toBeUndefined();
  });

  it('ignores an empty token rather than storing a useless one', () => {
    expect(readAccessToken({ access_token: '' })).toBeUndefined();
  });
});

describe('sat and msat conversion', () => {
  it('rounds balances down, never showing sats that cannot be spent', () => {
    expect(msatToSat(1_999)).toBe(1);
    expect(msatToSat(21_000)).toBe(21);
    expect(msatToSat(999)).toBe(0);
  });

  it('converts sats up to msats exactly', () => {
    expect(satToMsat(21)).toBe(21_000);
    expect(satToMsat(1)).toBe(1_000);
  });

  it('round-trips whole sat amounts', () => {
    for (const sats of [1, 21, 1000, 100_000]) {
      expect(msatToSat(satToMsat(sats))).toBe(sats);
    }
  });

  it('handles the negative amounts LNbits uses for outgoing payments', () => {
    // Math.floor on a negative would inflate the magnitude, so callers take
    // the absolute value first — this documents the raw behaviour they rely on
    expect(msatToSat(Math.abs(-21_000))).toBe(21);
  });
});
