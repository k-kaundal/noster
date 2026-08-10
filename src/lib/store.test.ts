import { describe, it, expect, vi } from 'vitest';
import {
  defineKey,
  onStorageFull,
  readStore,
  removeStore,
  subscribeStore,
  writeStore,
} from './store';

describe('store', () => {
  it('shares one value between readers, and tells them when it changes', () => {
    const key = defineKey<number>('test:count', 0);
    const listener = vi.fn();
    const unsubscribe = subscribeStore(key.name, listener);

    expect(readStore(key)).toBe(0);

    writeStore(key, 5);

    expect(readStore(key)).toBe(5);
    expect(localStorage.getItem(key.name)).toBe('5');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('applies an updater to the shared value, not to a stale copy', () => {
    const key = defineKey<number>('test:updater', 0);

    writeStore(key, 1);
    writeStore(key, (previous) => previous + 1);

    expect(readStore(key)).toBe(2);
  });

  it('keeps the same reference until something writes', () => {
    // useSyncExternalStore compares snapshots by identity and loops forever
    // on a getter that builds a new object each call
    const key = defineKey<string[]>('test:identity', []);
    expect(readStore(key)).toBe(readStore(key));

    writeStore(key, ['a']);
    const after = readStore(key);

    expect(after).toEqual(['a']);
    expect(readStore(key)).toBe(after);
  });

  it('falls back when what is stored cannot be parsed', () => {
    localStorage.setItem('test:corrupt', '{ not json');
    const key = defineKey('test:corrupt', { ok: true });

    expect(readStore(key)).toEqual({ ok: true });
  });

  it('falls back when a validating deserializer rejects what is stored', () => {
    // How the app config survives a shape written by an older build
    localStorage.setItem('test:strict', '{"theme":"nope"}');

    const key = defineKey(
      'test:strict',
      { theme: 'dark' },
      {
        deserialize: (raw: string) => {
          const parsed = JSON.parse(raw) as { theme: string };
          if (parsed.theme !== 'dark') throw new Error('unknown theme');
          return parsed;
        },
      }
    );

    expect(readStore(key)).toEqual({ theme: 'dark' });
  });

  it('gives one definition per key, however many times it is declared', () => {
    const first = defineKey<number>('test:once', 1);
    const second = defineKey<number>('test:once', 99);

    expect(second).toBe(first);
    expect(readStore(second)).toBe(1);
  });

  it('frees space and tries again when a write does not fit', () => {
    const key = defineKey<string>('test:quota', '');
    let full = true;

    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((name: string) => {
        if (full && name === key.name) throw new Error('QuotaExceededError');
      });

    const reclaim = vi.fn(() => {
      full = false;
    });
    const unregister = onStorageFull(reclaim);

    writeStore(key, 'value');

    expect(reclaim).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(readStore(key)).toBe('value');

    unregister();
    setItem.mockRestore();
  });

  it('keeps the value usable for the session when storage is unavailable', () => {
    const key = defineKey<string>('test:blocked', '');
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });

    writeStore(key, 'in memory');

    // Nothing persisted, but the app still behaves for as long as it is open
    expect(readStore(key)).toBe('in memory');

    setItem.mockRestore();
  });

  it('returns readers to the fallback on remove', () => {
    const key = defineKey<string>('test:removed', 'default');

    writeStore(key, 'set');
    removeStore(key);

    expect(readStore(key)).toBe('default');
    expect(localStorage.getItem(key.name)).toBeNull();
  });

  it('stores session-backed keys where they cannot outlive the tab', () => {
    const key = defineKey<number>('test:tab', 0, { backing: 'session' });

    writeStore(key, 7);

    expect(sessionStorage.getItem(key.name)).toBe('7');
    expect(localStorage.getItem(key.name)).toBeNull();
  });
});
