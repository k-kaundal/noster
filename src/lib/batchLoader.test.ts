import { describe, it, expect, vi } from 'vitest';
import { createBatchLoader } from './batchLoader';

describe('createBatchLoader', () => {
  it('resolves many concurrent requests with a single fetch', async () => {
    const fetch = vi.fn(async (keys: string[]) =>
      new Map(keys.map((key) => [key, key.toUpperCase()]))
    );

    const loader = createBatchLoader({
      fetch,
      emptyValue: () => '',
      windowMs: 5,
    });

    const results = await Promise.all([
      loader.load('a'),
      loader.load('b'),
      loader.load('c'),
    ]);

    expect(results).toEqual(['A', 'B', 'C']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toEqual(['a', 'b', 'c']);
  });

  it('collapses duplicate keys into one fetched key', async () => {
    const fetch = vi.fn(async (keys: string[]) =>
      new Map(keys.map((key) => [key, key.length]))
    );

    const loader = createBatchLoader({
      fetch,
      emptyValue: () => 0,
      windowMs: 5,
    });

    const results = await Promise.all([
      loader.load('same'),
      loader.load('same'),
      loader.load('same'),
    ]);

    expect(results).toEqual([4, 4, 4]);
    // Every caller still gets a value, but the key is only requested once
    expect(fetch.mock.calls[0][0]).toEqual(['same']);
  });

  it('hands back the empty value for keys the fetch omitted', async () => {
    const loader = createBatchLoader({
      fetch: async () => new Map([['found', 'yes']]),
      emptyValue: () => 'missing',
      windowMs: 5,
    });

    await expect(loader.load('absent')).resolves.toBe('missing');
  });

  it('splits oversized batches so relay filters stay bounded', async () => {
    const fetch = vi.fn(async (keys: string[]) =>
      new Map(keys.map((key) => [key, key]))
    );

    const loader = createBatchLoader({
      fetch,
      emptyValue: () => '',
      windowMs: 5,
      maxBatchSize: 2,
    });

    const keys = ['a', 'b', 'c', 'd', 'e'];
    await Promise.all(keys.map((key) => loader.load(key)));

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });

  it('rejects the waiting callers when the fetch fails', async () => {
    const loader = createBatchLoader({
      fetch: async () => {
        throw new Error('relay unreachable');
      },
      emptyValue: () => null,
      windowMs: 5,
    });

    await expect(loader.load('a')).rejects.toThrow('relay unreachable');
  });

  it('starts a fresh batch after the previous one flushes', async () => {
    const fetch = vi.fn(async (keys: string[]) =>
      new Map(keys.map((key) => [key, key]))
    );

    const loader = createBatchLoader({
      fetch,
      emptyValue: () => '',
      windowMs: 5,
    });

    await loader.load('first');
    await loader.load('second');

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
