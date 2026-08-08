import { describe, it, expect } from 'vitest';
import { withPrimaryFirst } from './relayRouting';

const HOUSE = 'wss://relay.nostrfeed.com';

describe('withPrimaryFirst', () => {
  it('moves the primary to the front when it is buried in the list', () => {
    const urls = ['wss://a.example', 'wss://b.example', HOUSE];
    expect(withPrimaryFirst(urls, HOUSE)[0]).toBe(HOUSE);
  });

  it('adds the primary when it is missing entirely', () => {
    expect(withPrimaryFirst(['wss://a.example'], HOUSE)).toEqual([
      HOUSE,
      'wss://a.example',
    ]);
  });

  it('does not duplicate the primary', () => {
    const result = withPrimaryFirst([HOUSE, 'wss://a.example'], HOUSE);
    expect(result.filter((url) => url === HOUSE)).toHaveLength(1);
  });

  it('keeps the primary after truncation to the relay cap', () => {
    // The whole point: a long list must not push the primary off the end
    const many = Array.from({ length: 20 }, (_, i) => `wss://r${i}.example`);
    const targets = withPrimaryFirst(many, HOUSE).slice(0, 8);

    expect(targets).toHaveLength(8);
    expect(targets).toContain(HOUSE);
  });

  it('preserves the order of the remaining relays', () => {
    const urls = ['wss://a.example', HOUSE, 'wss://b.example'];
    expect(withPrimaryFirst(urls, HOUSE)).toEqual([
      HOUSE,
      'wss://a.example',
      'wss://b.example',
    ]);
  });

  it('collapses duplicates the config may contain', () => {
    const urls = ['wss://a.example', 'wss://a.example'];
    expect(withPrimaryFirst(urls, HOUSE)).toEqual([HOUSE, 'wss://a.example']);
  });

  it('returns the list unchanged when there is no primary', () => {
    expect(withPrimaryFirst(['wss://a.example'], '')).toEqual([
      'wss://a.example',
    ]);
  });

  it('yields just the primary for an empty list', () => {
    expect(withPrimaryFirst([], HOUSE)).toEqual([HOUSE]);
  });
});
