import { describe, it, expect, beforeEach } from 'vitest';
import {
  SIGNER_FAILURES,
  clearSignerFailure,
  readSignerFailure,
  recordSignerFailure,
} from './signerStatus';
import { removeStore } from './store';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

beforeEach(() => {
  removeStore(SIGNER_FAILURES);
});

describe('recordSignerFailure', () => {
  it('remembers a signer that could not be reached', () => {
    recordSignerFailure(ALICE, 'unreachable');
    expect(readSignerFailure(ALICE)).toBe('unreachable');
  });

  it('ignores a refusal, which is the person working as intended', () => {
    // Remembering "declined" would turn saying no into a standing complaint
    // about your own signer
    recordSignerFailure(ALICE, 'declined');
    expect(readSignerFailure(ALICE)).toBeUndefined();
  });

  it('ignores failures it has no diagnosis for', () => {
    recordSignerFailure(ALICE, 'unknown');
    recordSignerFailure(ALICE, 'read-only');
    expect(readSignerFailure(ALICE)).toBeUndefined();
  });

  it('keeps accounts apart', () => {
    recordSignerFailure(ALICE, 'unreachable');
    expect(readSignerFailure(BOB)).toBeUndefined();
  });

  it('does not churn the stored value when nothing changed', () => {
    // Subscribers re-render on write, and a failing signer is retried often
    recordSignerFailure(ALICE, 'unreachable');
    const first = readSignerFailure(ALICE);

    recordSignerFailure(ALICE, 'unreachable');
    expect(readSignerFailure(ALICE)).toBe(first);
  });
});

describe('clearSignerFailure', () => {
  it('forgets on success, because one signature disproves the whole thing', () => {
    recordSignerFailure(ALICE, 'unreachable');
    clearSignerFailure(ALICE);

    expect(readSignerFailure(ALICE)).toBeUndefined();
  });

  it('leaves other accounts alone', () => {
    recordSignerFailure(ALICE, 'unreachable');
    recordSignerFailure(BOB, 'unreachable');
    clearSignerFailure(ALICE);

    expect(readSignerFailure(BOB)).toBe('unreachable');
  });

  it('is safe to call when there is nothing to clear', () => {
    expect(() => clearSignerFailure(ALICE)).not.toThrow();
    expect(() => clearSignerFailure('')).not.toThrow();
  });
});
