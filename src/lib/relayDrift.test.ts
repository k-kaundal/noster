import { describe, it, expect } from 'vitest';
import { NO_DRIFT, compareRelayLists, describeDrift } from './relayDrift';
import type { RelayEntry } from './relay';

const entry = (url: string, over: Partial<RelayEntry> = {}): RelayEntry => ({
  url,
  read: true,
  write: true,
  ...over,
});

describe('compareRelayLists', () => {
  it('says nothing when the lists agree', () => {
    const drift = compareRelayLists(
      [entry('wss://a.example'), entry('wss://b.example')],
      [entry('wss://b.example'), entry('wss://a.example')]
    );

    expect(drift.inSync).toBe(true);
    expect(drift.added).toEqual([]);
    expect(drift.dropped).toEqual([]);
  });

  it('finds a relay used here and never published', () => {
    // Notes go somewhere nobody has been told to look
    const drift = compareRelayLists(
      [entry('wss://a.example'), entry('wss://new.example')],
      [entry('wss://a.example')]
    );

    expect(drift.added).toEqual(['wss://new.example']);
    expect(drift.inSync).toBe(false);
  });

  it('finds a relay still published and no longer used', () => {
    // Strangers keep querying a relay you left
    const drift = compareRelayLists(
      [entry('wss://a.example')],
      [entry('wss://a.example'), entry('wss://old.example')]
    );

    expect(drift.dropped).toEqual(['wss://old.example']);
    expect(drift.inSync).toBe(false);
  });

  it('compares canonically, so one relay is not two', () => {
    /*
     * `wss://a.example` and `wss://A.example/` are the same relay. Reporting
     * them as one added and one dropped would be a warning that can never be
     * cleared.
     */
    const drift = compareRelayLists(
      [entry('wss://A.example/')],
      [entry('wss://a.example')]
    );

    expect(drift.inSync).toBe(true);
  });

  it('ignores read and write markers', () => {
    /*
     * A relay moving from read to write is worth republishing and is not this
     * failure. Reporting drift on lists naming the same relays is the fastest
     * way to teach somebody to ignore the warning.
     */
    const drift = compareRelayLists(
      [entry('wss://a.example', { write: false })],
      [entry('wss://a.example', { write: true })]
    );

    expect(drift.inSync).toBe(true);
  });

  it('treats nothing published as its own case, not as drift', () => {
    // "Other clients cannot find you" wants a different sentence from
    // "your list is out of date"
    expect(compareRelayLists([entry('wss://a.example')], undefined)).toEqual(
      NO_DRIFT
    );
  });

  it('reports every relay as dropped when the published list is empty', () => {
    const drift = compareRelayLists([entry('wss://a.example')], []);

    expect(drift.published).toBe(true);
    expect(drift.added).toEqual(['wss://a.example']);
  });

  it('sorts, so the same drift reads the same every time', () => {
    const drift = compareRelayLists(
      [entry('wss://z.example'), entry('wss://a.example')],
      []
    );

    expect(drift.added).toEqual(['wss://a.example', 'wss://z.example']);
  });

  it('drops an unusable url rather than counting it', () => {
    expect(compareRelayLists([entry('   ')], []).added).toEqual([]);
  });
});

describe('describeDrift', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describeDrift(NO_DRIFT)).toBe('');
    expect(
      describeDrift({ added: [], dropped: [], inSync: true, published: true })
    ).toBe('');
  });

  it('counts what changed', () => {
    expect(
      describeDrift({
        added: ['wss://a'],
        dropped: ['wss://b', 'wss://c'],
        inSync: false,
        published: true,
      })
    ).toBe('1 relay added, 2 relays dropped');
  });

  it('names only the half that changed', () => {
    expect(
      describeDrift({
        added: ['wss://a', 'wss://b'],
        dropped: [],
        inSync: false,
        published: true,
      })
    ).toBe('2 relays added');
  });
});
