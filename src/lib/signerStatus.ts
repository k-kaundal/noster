import { defineKey, readStore, writeStore } from './store';
import type { SignerFailure } from './signerErrors';

/**
 * What we last saw a signer do, so the next thing that needs it already knows.
 *
 * A failed signature is the only unambiguous evidence that a remote signer is
 * gone — a probe can be answered from a cache, but a signature cannot be
 * faked — and it used to be thrown away the moment its toast was dismissed.
 * The next post ran into the same wall and reported it as if it were news.
 *
 * Kept per session rather than forever: a bunker that was offline this morning
 * is usually back, and starting a new tab with a warning about a signer nobody
 * has tried yet would be a worse lie than saying nothing.
 */
const FAILURES = defineKey<Record<string, SignerFailure>>(
  'signer:failures',
  {},
  { backing: 'session' }
);

export const SIGNER_FAILURES = FAILURES;

/**
 * Only failures that mean the signer is out of reach.
 *
 * A declined signature is the person saying no, which is working exactly as
 * intended, and remembering it would turn a deliberate refusal into a
 * standing complaint about their own signer.
 */
function worthRemembering(kind: SignerFailure): boolean {
  return kind === 'unreachable' || kind === 'missing-extension';
}

export function recordSignerFailure(pubkey: string, kind: SignerFailure): void {
  if (!pubkey || !worthRemembering(kind)) return;

  writeStore(FAILURES, (previous) =>
    previous[pubkey] === kind ? previous : { ...previous, [pubkey]: kind }
  );
}

/** Called on any success: one working signature disproves the whole thing. */
export function clearSignerFailure(pubkey: string): void {
  if (!pubkey) return;

  writeStore(FAILURES, (previous) => {
    if (!(pubkey in previous)) return previous;

    const next = { ...previous };
    delete next[pubkey];
    return next;
  });
}

export function readSignerFailure(pubkey: string): SignerFailure | undefined {
  return pubkey ? readStore(FAILURES)[pubkey] : undefined;
}
