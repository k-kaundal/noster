import { describe, it, expect, vi } from 'vitest';
import {
  describeError,
  isExtensionNotEnabled,
  isMissingSession,
  LnbitsError,
  msatToSat,
  readAccessToken,
  readBalanceMsat,
  readBolt11,
  satToMsat,
  withExtension,
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

describe('readBalanceMsat', () => {
  it('reads the field name the OpenAPI model uses', () => {
    expect(readBalanceMsat({ balance_msat: 21_000 })).toBe(21_000);
  });

  it('reads the field name the API panel documents', () => {
    // GET /api/v1/wallet is documented as {id, name, balance}
    expect(readBalanceMsat({ id: 'w', name: 'x', balance: 21_000 })).toBe(21_000);
  });

  it('prefers balance_msat when a response carries both', () => {
    expect(readBalanceMsat({ balance_msat: 1, balance: 2 })).toBe(1);
  });

  it('reports zero rather than NaN for a malformed body', () => {
    expect(readBalanceMsat({ balance: 'lots' })).toBe(0);
    expect(readBalanceMsat(null)).toBe(0);
    expect(readBalanceMsat(undefined)).toBe(0);
  });

  it('keeps a zero balance distinguishable from a missing one', () => {
    expect(readBalanceMsat({ balance_msat: 0 })).toBe(0);
  });
});

describe('readBolt11', () => {
  it('reads the OpenAPI field', () => {
    expect(readBolt11({ bolt11: 'lnbc1...' })).toBe('lnbc1...');
  });

  it('reads the payment_request alias the invoice endpoint returns', () => {
    expect(readBolt11({ payment_hash: 'h', payment_request: 'lnbc1...' })).toBe(
      'lnbc1...'
    );
  });

  it('returns an empty string rather than undefined when neither is set', () => {
    expect(readBolt11({ payment_hash: 'h' })).toBe('');
    expect(readBolt11(null)).toBe('');
  });
});

describe('isMissingSession', () => {
  it('treats a 401 as simply not being signed in', () => {
    expect(isMissingSession(new LnbitsError('Not authorised', 401))).toBe(true);
  });

  it('treats a 403 the same way', () => {
    expect(isMissingSession(new LnbitsError('Forbidden', 403))).toBe(true);
  });

  it("recognises LNbits' 400 for a request with no credentials", () => {
    // What /api/v1/auth actually answers on a browser that has never
    // connected. Reported as an error, it puts raw API text on screen.
    expect(
      isMissingSession(
        new LnbitsError('Missing user ID or access token.', 400)
      )
    ).toBe(true);
  });

  it('does not swallow an unrelated 400', () => {
    expect(isMissingSession(new LnbitsError('Invalid wallet id', 400))).toBe(
      false
    );
  });

  it('does not swallow a server fault', () => {
    expect(isMissingSession(new LnbitsError('Internal error', 500))).toBe(false);
  });

  it('ignores errors that did not come from LNbits', () => {
    expect(isMissingSession(new Error('Failed to fetch'))).toBe(false);
  });
});

describe('isExtensionNotEnabled', () => {
  const refusal = (detail: string, status = 403) =>
    new LnbitsError(describeError({ detail }, status), status, { detail });

  it('recognises the wording this LNbits actually returns', () => {
    /*
     * The bug this was written for. The check tested for one exact phrase —
     * `extension 'lnurlp' not enabled` — so an instance answering with the
     * sentence below fell straight through `withExtension` and the user saw a
     * raw authorisation error on a feature that was one PUT away from working.
     */
    const error = refusal("User not authorized for extension 'lnurlp'.");

    expect(isExtensionNotEnabled(error, 'lnurlp')).toBe(true);
  });

  it('still recognises the older wording', () => {
    expect(
      isExtensionNotEnabled(refusal("Extension 'lnurlp' not enabled."), 'lnurlp')
    ).toBe(true);
  });

  it('recognises it unquoted', () => {
    expect(
      isExtensionNotEnabled(refusal('Extension lnurlp not enabled.'), 'lnurlp')
    ).toBe(true);
  });

  it('does not mistake an expired session for a disabled extension', () => {
    /*
     * A bare authorisation failure needs a fresh login, and quietly trying to
     * enable something instead would hide that — so the message has to name
     * the extension as well as complain.
     */
    expect(isExtensionNotEnabled(refusal('Not authorized.', 401), 'lnurlp')).toBe(
      false
    );
  });

  it('does not confuse one extension for another', () => {
    expect(
      isExtensionNotEnabled(refusal("User not authorized for extension 'nostrnip5'."), 'lnurlp')
    ).toBe(false);
  });

  it('ignores anything that is not an LNbits refusal', () => {
    expect(isExtensionNotEnabled(new Error('offline'), 'lnurlp')).toBe(false);
    expect(isExtensionNotEnabled(undefined, 'lnurlp')).toBe(false);
  });
});

describe('withExtension', () => {
  const refusal = () =>
    new LnbitsError("User not authorized for extension 'lnurlp'.", 403, {});

  it('passes a working request straight through', async () => {
    let calls = 0;
    const result = await withExtension('lnurlp', 'token', async () => {
      calls += 1;
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries once the extension has been switched on', async () => {
    // `enableExtension` is a real PUT; the retry is what is under test here
    const fetchMock = vi.fn(async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    let calls = 0;
    const result = await withExtension('lnurlp', 'token', async () => {
      calls += 1;
      if (calls === 1) throw refusal();
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(2);

    // Enabled for the account, with the session token rather than an API key
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/extension/lnurlp/enable');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');

    vi.unstubAllGlobals();
  });

  it('says who can fix it when enabling is refused too', async () => {
    /*
     * The remedy failing means something an account cannot fix — the extension
     * is not installed, or the instance forbids users enabling their own.
     * Repeating the original refusal would send the reader back round the same
     * loop.
     */
    vi.stubGlobal('fetch', async () =>
      new Response('{"detail":"Not found"}', { status: 404 })
    );

    await expect(
      withExtension('lnurlp', 'token', async () => {
        throw refusal();
      })
    ).rejects.toThrow(/administrator/i);

    vi.unstubAllGlobals();
  });

  it('explains the missing session rather than repeating the server', async () => {
    /*
     * "Not authorized for extension" reads like a permissions problem an
     * administrator has to solve. Without a token the real cause is that this
     * browser has no LNbits session to enable anything with, and only one of
     * those two is something the reader can act on.
     */
    await expect(
      withExtension('lnurlp', undefined, async () => {
        throw refusal();
      })
    ).rejects.toThrow(/no LNbits session/i);
  });

  it('leaves an unrelated failure alone', async () => {
    await expect(
      withExtension('lnurlp', 'token', async () => {
        throw new LnbitsError('Insufficient balance.', 402, {});
      })
    ).rejects.toThrow('Insufficient balance.');
  });
});
