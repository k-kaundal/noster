import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  MAX_AGE_MS,
  isRestorable,
  persistQueryCache,
  restoreQueryCache,
  serializeCache,
  shouldPersistKey,
} from './queryPersistence';

const NOW = Date.parse('2026-08-08T12:00:00Z');

function clientWith(entries: [readonly unknown[], unknown][]): QueryClient {
  const client = new QueryClient();
  for (const [key, data] of entries) client.setQueryData(key, data);
  return client;
}

beforeEach(() => {
  localStorage.clear();
});

describe('shouldPersistKey', () => {
  it('keeps profiles and the feed, which are what make a cold start slow', () => {
    expect(shouldPersistKey(['author', 'abc'])).toBe(true);
    expect(shouldPersistKey(['feed', 'global', 0])).toBe(true);
  });

  it('refuses wallet data, which must never be shown stale', () => {
    expect(shouldPersistKey(['lnbits-wallets', 'x'])).toBe(false);
    expect(shouldPersistKey(['lnbits-account'])).toBe(false);
  });

  it('refuses private messages, which should not outlive the tab in plain text', () => {
    expect(shouldPersistKey(['direct-messages', 'npub'])).toBe(false);
  });

  it('refuses a key that is not a string', () => {
    expect(shouldPersistKey([{ scope: 'author' }])).toBe(false);
    expect(shouldPersistKey([])).toBe(false);
  });
});

describe('isRestorable', () => {
  const stored = { version: 1, savedAt: NOW, state: { queries: [] } };

  it('accepts a cache saved just now', () => {
    expect(isRestorable(stored, NOW)).toBe(true);
  });

  it('refuses one older than a day', () => {
    expect(isRestorable({ ...stored, savedAt: NOW - MAX_AGE_MS - 1 }, NOW)).toBe(
      false
    );
  });

  it('refuses a version it does not recognise', () => {
    // Restoring last week's shape into this week's components is how a cache
    // becomes a crash
    expect(isRestorable({ ...stored, version: 0 }, NOW)).toBe(false);
  });

  it('refuses junk', () => {
    expect(isRestorable(null, NOW)).toBe(false);
    expect(isRestorable('{}', NOW)).toBe(false);
    expect(isRestorable({ version: 1, savedAt: NOW }, NOW)).toBe(false);
  });
});

describe('serializeCache', () => {
  it('writes the persistable queries and leaves the rest', () => {
    const client = clientWith([
      [['author', 'alice'], { name: 'Alice' }],
      [['lnbits-wallets', 'w'], { balance: 100 }],
    ]);

    const serialized = serializeCache(client, NOW)!;

    expect(serialized).toContain('alice');
    expect(serialized).not.toContain('lnbits-wallets');
  });

  it('stamps the time so age can be checked on the way back in', () => {
    const parsed = JSON.parse(serializeCache(new QueryClient(), NOW)!);

    expect(parsed.savedAt).toBe(NOW);
    expect(parsed.version).toBe(1);
  });

  it('returns null rather than a payload too big to store', () => {
    const client = clientWith([[['feed', 'global'], 'x'.repeat(2_000_000)]]);

    expect(serializeCache(client, NOW)).toBeNull();
  });
});

describe('restoreQueryCache', () => {
  it('puts the data back where the app will find it', () => {
    const source = clientWith([[['author', 'alice'], { name: 'Alice' }]]);
    localStorage.setItem('nostr:query-cache', serializeCache(source, NOW)!);

    const target = new QueryClient();
    restoreQueryCache(target);

    expect(target.getQueryData(['author', 'alice'])).toEqual({ name: 'Alice' });
  });

  it('discards a stale cache instead of restoring it', () => {
    const source = clientWith([[['author', 'alice'], { name: 'Alice' }]]);
    localStorage.setItem(
      'nostr:query-cache',
      serializeCache(source, Date.now() - MAX_AGE_MS - 1000)!
    );

    const target = new QueryClient();
    restoreQueryCache(target);

    expect(target.getQueryData(['author', 'alice'])).toBeUndefined();
    expect(localStorage.getItem('nostr:query-cache')).toBeNull();
  });

  it('survives a corrupt cache', () => {
    localStorage.setItem('nostr:query-cache', 'not json');

    expect(() => restoreQueryCache(new QueryClient())).not.toThrow();
    expect(localStorage.getItem('nostr:query-cache')).toBeNull();
  });

  it('does nothing when there is no cache', () => {
    expect(() => restoreQueryCache(new QueryClient())).not.toThrow();
  });
});

describe('persistQueryCache', () => {
  it('writes after the throttle window, not on every change', async () => {
    const client = new QueryClient();
    const stop = persistQueryCache(client, 5);

    client.setQueryData(['author', 'alice'], { name: 'Alice' });
    expect(localStorage.getItem('nostr:query-cache')).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(localStorage.getItem('nostr:query-cache')).toContain('alice');

    stop();
  });

  it('stops writing once cancelled', async () => {
    const client = new QueryClient();
    const stop = persistQueryCache(client, 5);

    client.setQueryData(['author', 'alice'], { name: 'Alice' });
    stop();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(localStorage.getItem('nostr:query-cache')).toBeNull();
  });
});
