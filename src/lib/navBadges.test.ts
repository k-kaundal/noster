import { describe, it, expect } from 'vitest';
import { countReachable, formatCount } from './navBadges';

describe('formatCount', () => {
  it('shows a count', () => {
    expect(formatCount(7)).toBe('7');
  });

  it('shows nothing for none', () => {
    // An empty badge is a row with nothing after it, which is the point
    expect(formatCount(0)).toBe('');
    expect(formatCount(-1)).toBe('');
  });

  it('stops counting where the number stops being the point', () => {
    expect(formatCount(99)).toBe('99');
    expect(formatCount(100)).toBe('99+');
    expect(formatCount(4210)).toBe('99+');
  });
});

describe('countReachable', () => {
  const metrics = (entries: [string, string][]) =>
    entries.map(([url, status]) => ({ url, status }));

  it('counts the relays that answer', () => {
    const configured = ['wss://a', 'wss://b', 'wss://c'];
    const seen = metrics([
      ['wss://a', 'healthy'],
      ['wss://b', 'dead'],
      ['wss://c', 'healthy'],
    ]);

    expect(countReachable(configured, seen)).toEqual({ up: 2, total: 3 });
  });

  it('treats a relay nobody has needed yet as reachable', () => {
    /*
     * On the first screen of a session almost nothing has been asked of
     * anything. Counting unknown as down would greet a perfectly healthy app
     * with "0/7" and send people to fix a relay list that is fine.
     */
    expect(countReachable(['wss://a', 'wss://b'], [])).toEqual({
      up: 2,
      total: 2,
    });
  });

  it('counts a degraded relay as up, because it is', () => {
    const seen = metrics([['wss://a', 'degraded']]);
    expect(countReachable(['wss://a'], seen).up).toBe(1);
  });

  it('ignores metrics for relays that are no longer configured', () => {
    // The monitor outlives a relay-list edit
    const seen = metrics([
      ['wss://a', 'healthy'],
      ['wss://gone', 'dead'],
    ]);

    expect(countReachable(['wss://a'], seen)).toEqual({ up: 1, total: 1 });
  });

  it('has nothing to say about an empty relay list', () => {
    expect(countReachable([], [])).toEqual({ up: 0, total: 0 });
  });
});
