import { describe, it, expect } from 'vitest';
import { classifySignerError, describeSignerError } from './signerErrors';
import { ReadOnlyError } from './session';

describe('classifySignerError', () => {
  it('knows a read-only session by type, not by wording', () => {
    expect(classifySignerError(new ReadOnlyError())).toBe('read-only');
  });

  it('reads the many ways a signer says no', () => {
    // Every signer phrases refusal differently and none of them is an error
    // worth apologising for
    for (const message of [
      'User rejected the request',
      'Request denied',
      'user declined',
      'Cancelled by user',
      'Refused',
    ]) {
      expect(classifySignerError(new Error(message))).toBe('declined');
    }
  });

  it('treats a timeout as a signer that has gone away', () => {
    // NIP-46 has no liveness signal, so a timeout is the only evidence a
    // bunker is gone — and "reconnect" is right far more often than "retry"
    expect(classifySignerError(new DOMException('aborted', 'AbortError'))).toBe(
      'unreachable'
    );
    expect(classifySignerError(new Error('Request timed out'))).toBe(
      'unreachable'
    );
    expect(classifySignerError(new Error('websocket closed'))).toBe(
      'unreachable'
    );
  });

  it('spots a missing extension', () => {
    expect(
      classifySignerError(new Error('Nostr extension not found. Please install a NIP-07 extension.'))
    ).toBe('missing-extension');
    expect(classifySignerError(new Error('window.nostr is undefined'))).toBe(
      'missing-extension'
    );
  });

  it('gives up gracefully on things that are not errors at all', () => {
    // Extensions really do reject with bare objects and empty strings
    expect(classifySignerError(undefined)).toBe('unknown');
    expect(classifySignerError({})).toBe('unknown');
    expect(classifySignerError('')).toBe('unknown');
    expect(classifySignerError({ message: 'boom' })).toBe('unknown');
  });
});

describe('describeSignerError', () => {
  it('tells a read-only reader what to do instead of what broke', () => {
    const problem = describeSignerError(new ReadOnlyError());

    expect(problem.retryable).toBe(false);
    expect(problem.description).toMatch(/log in/i);
  });

  it('says reconnect for a bunker and retry for anything else', () => {
    const timeout = new Error('timed out');

    expect(
      describeSignerError(timeout, { method: 'bunker' }).description
    ).toMatch(/reconnect/i);
    expect(
      describeSignerError(timeout, { method: 'extension' }).description
    ).not.toMatch(/reconnect/i);
  });

  it('reassures that nothing was published, because that is the real worry', () => {
    expect(describeSignerError(new Error('user rejected')).description).toMatch(
      /nothing was published/i
    );
  });

  it('falls back to whatever the signer said rather than saying nothing', () => {
    expect(describeSignerError(new Error('weird internal failure')).description).toContain(
      'weird internal failure'
    );
  });

  it('has something to say even when the signer said nothing', () => {
    expect(describeSignerError({}).description).toBeTruthy();
  });
});
