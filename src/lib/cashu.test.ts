import { describe, it, expect } from 'vitest';
import { deserializeProofs, type Proof } from '@cashu/cashu-ts';
import {
  activeInputFeePpk,
  consumedProofs,
  inputFeeSats,
  foldConcurrentChanges,
  mergeProofs,
  parseProofs,
  proofsToSats,
  toWireProofs,
  withoutProofs,
} from './cashu';

/** Proofs as the mint issues them: powers of two adding to `sats`. */
function proofsFor(sats: number, prefix = 'p'): Proof[] {
  const parts: number[] = [];
  let left = sats;
  let denomination = 1;

  while (left > 0) {
    if (left & 1) parts.push(denomination);
    denomination *= 2;
    left >>= 1;
  }

  return deserializeProofs(
    parts.map((amount, index) => ({
      id: '01aa',
      amount,
      secret: `${prefix}-${amount}-${index}`,
      C: `c${index}`,
    }))
  );
}

describe('proofsToSats', () => {
  it('adds up what the mint issued', () => {
    // 100 sats is 64 + 32 + 4, and a wallet that gets this wrong is a wallet
    // that shows someone the wrong amount of their own money
    expect(proofsToSats(proofsFor(100))).toBe(100);
    expect(proofsToSats(proofsFor(1))).toBe(1);
    expect(proofsToSats(proofsFor(21_000))).toBe(21_000);
  });

  it('is zero for nothing', () => {
    expect(proofsToSats([])).toBe(0);
  });

  it('survives the trip through storage', () => {
    // Amounts are objects in memory and JSON on disk; a round trip that
    // stringifies them lands a balance of "64" rather than 64
    const stored = JSON.parse(JSON.stringify(toWireProofs(proofsFor(100))));
    expect(proofsToSats(parseProofs(stored))).toBe(100);
  });
});

describe('foldConcurrentChanges', () => {
  it('keeps a deposit that landed while the balance was being read', () => {
    // The bug this exists for. Reading the balance takes a relay query, a
    // decrypt per backup and a round trip to the mint; a deposit finishing
    // inside that window used to be erased by the read that started before it
    const beforeRead = proofsFor(100, 'old');
    const depositedMeanwhile = proofsFor(500, 'new');

    const folded = foldConcurrentChanges(
      beforeRead,
      beforeRead,
      mergeProofs(beforeRead, depositedMeanwhile),
      []
    );

    expect(proofsToSats(folded)).toBe(600);
  });

  it('does not resurrect what the mint reported spent', () => {
    // Storage still holds everything the read started from, spent proofs
    // included, so folding all of it back in undoes the spent-check entirely:
    // the balance counts money that is gone, the next read drops it again,
    // and the number swings between the two
    const started = proofsFor(100, 'held');
    const gone = started.slice(0, 1);
    const survived = started.slice(1);

    const folded = foldConcurrentChanges(survived, started, started, []);

    expect(proofsToSats(folded)).toBe(
      100 - Number(gone[0].amount.toNumber())
    );
  });

  it('keeps a deposit even while dropping a spent proof', () => {
    // Both at once, which is the case the two rules have to agree on
    const started = proofsFor(100, 'held');
    const survived = started.slice(1);
    const deposited = proofsFor(500, 'new');

    const folded = foldConcurrentChanges(
      survived,
      started,
      mergeProofs(started, deposited),
      []
    );

    expect(proofsToSats(folded)).toBe(
      100 - Number(started[0].amount.toNumber()) + 500
    );
  });

  it('does not resurrect proofs spent while the balance was being read', () => {
    // The other direction: a send that completed mid-read recorded its proofs
    // as used, and this pass must not put them back
    const held = proofsFor(100, 'held');
    const spent = held.slice(0, 1);

    const folded = foldConcurrentChanges(
      held,
      held,
      withoutProofs(held, spent.map((proof) => proof.secret)),
      spent.map((proof) => proof.secret)
    );

    expect(proofsToSats(folded)).toBe(100 - Number(spent[0].amount.toNumber()));
  });

  it('counts a proof once when both copies have it', () => {
    const held = proofsFor(100);
    expect(proofsToSats(foldConcurrentChanges(held, held, held, []))).toBe(100);
  });
});

describe('consumedProofs', () => {
  it('finds the inputs a swap spent', () => {
    // wallet.send does not slice a set in two — it spends inputs at the mint
    // and returns fresh proofs, so the originals are gone and belong in the
    // used list or a stale backup adds them back
    const available = proofsFor(100, 'in');
    const keep = proofsFor(60, 'out-keep');
    const sent = proofsFor(40, 'out-send');

    expect(consumedProofs(available, keep, sent)).toEqual(available);
  });

  it('leaves untouched proofs alone', () => {
    // A swap that only needed some of them returns the rest in `keep`, and
    // marking those used would delete money that was never spent
    const available = proofsFor(100, 'in');
    const untouched = available.slice(0, 1);

    expect(consumedProofs(available, untouched)).toEqual(available.slice(1));
  });

  it('is empty when nothing was consumed', () => {
    const available = proofsFor(100, 'in');
    expect(consumedProofs(available, available)).toEqual([]);
    expect(consumedProofs([], [])).toEqual([]);
  });
});

describe('mergeProofs', () => {
  it('deduplicates by secret, so a balance is never counted twice', () => {
    // Local storage and the relay backup legitimately hold the same proofs
    const held = proofsFor(100);
    expect(proofsToSats(mergeProofs(held, held, held))).toBe(100);
  });
});

describe('inputFeeSats', () => {
  it('rounds a part-sat fee up to the next whole sat', () => {
    // NUT-02's worked example: 100 ppk is 0.1 sat per input, so 3 inputs cost
    // ceil(0.3) == 1 sat, and 1 through 10 inputs all cost the same 1 sat
    expect(inputFeeSats(1, 100)).toBe(1);
    expect(inputFeeSats(3, 100)).toBe(1);
    expect(inputFeeSats(10, 100)).toBe(1);
    expect(inputFeeSats(11, 100)).toBe(2);
    expect(inputFeeSats(20, 100)).toBe(2);
  });

  it('is free when the mint charges nothing', () => {
    expect(inputFeeSats(50, 0)).toBe(0);
    expect(inputFeeSats(0, 100)).toBe(0);
  });

  it('matches the spec at exact multiples', () => {
    // 1000 ppk is exactly 1 sat per input; rounding up must not add one more
    expect(inputFeeSats(1, 1000)).toBe(1);
    expect(inputFeeSats(5, 1000)).toBe(5);
  });
});

describe('activeInputFeePpk', () => {
  it('reads the fee off the active sat keyset', () => {
    expect(
      activeInputFeePpk([
        { unit: 'sat', isActive: true, fee: 100 },
        { unit: 'sat', isActive: false, fee: 0 },
      ])
    ).toBe(100);
  });

  it('ignores keysets in another unit', () => {
    // A mint can run usd and sat keysets side by side, and a usd fee says
    // nothing about what spending sats costs
    expect(
      activeInputFeePpk([{ unit: 'usd', isActive: true, fee: 500 }])
    ).toBe(0);
  });

  it('is zero when the mint charges nothing or says nothing', () => {
    expect(activeInputFeePpk([])).toBe(0);
    expect(activeInputFeePpk([{ unit: 'sat', isActive: true, fee: 0 }])).toBe(0);
  });
});
