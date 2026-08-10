export type StoreBacking = 'local' | 'session';

export interface StoreKey<T> {
  /** The literal storage key. Unique across the app. */
  readonly name: string;
  readonly backing: StoreBacking;
  readonly fallback: T;
  readonly serialize: (value: T) => string;
  readonly deserialize: (raw: string) => T;
}

/**
 * One place that owns persisted state.
 *
 * The app had a dozen components reading `localStorage` through a hook that
 * kept a private copy of every value. Two components on the same key were two
 * pieces of state that only agreed until one of them changed — the wallet's
 * sign-out had to bypass the hook entirely and read storage itself, because
 * the copy it was holding had been taken before the session existed.
 *
 * So values live here instead, cached once and shared. Writing notifies every
 * reader in this tab, and a write from another tab drops the cache so the next
 * read picks it up. A component holding stale state is no longer possible.
 */

/** Parsed values, keyed by storage key. Identity is stable until a write. */
const cache = new Map<string, unknown>();

const listeners = new Map<string, Set<() => void>>();

/** Definitions, so the same key is never described two different ways. */
const registry = new Map<string, StoreKey<unknown>>();

/** Called when a write fails for want of room. */
const reclaimers = new Set<() => void>();

function area(backing: StoreBacking): Storage | null {
  try {
    return backing === 'session' ? sessionStorage : localStorage;
  } catch {
    // Blocked entirely: private mode in some browsers, or a cookie policy
    return null;
  }
}

/**
 * Declares a key once, at module scope.
 *
 * Returning the existing definition rather than a second one matters: the
 * cache and the listener set are keyed by name, so two descriptions of one key
 * would be two views of the same value that disagree about how to read it.
 */
export function defineKey<T>(
  name: string,
  fallback: T,
  options: {
    backing?: StoreBacking;
    serialize?: (value: T) => string;
    deserialize?: (raw: string) => T;
  } = {}
): StoreKey<T> {
  const existing = registry.get(name);
  if (existing) return existing as StoreKey<T>;

  const key: StoreKey<T> = {
    name,
    backing: options.backing ?? 'local',
    fallback,
    serialize: options.serialize ?? JSON.stringify,
    deserialize: options.deserialize ?? (JSON.parse as (raw: string) => T),
  };

  registry.set(name, key as StoreKey<unknown>);
  return key;
}

function load<T>(key: StoreKey<T>): T {
  const storage = area(key.backing);
  if (!storage) return key.fallback;

  try {
    const raw = storage.getItem(key.name);
    return raw === null ? key.fallback : key.deserialize(raw);
  } catch {
    // Corrupt, or written by a version that shaped it differently. The
    // fallback is always usable, which a half-parsed object is not.
    return key.fallback;
  }
}

function notify(name: string): void {
  const set = listeners.get(name);
  if (!set) return;

  for (const listener of [...set]) listener();
}

function persist<T>(key: StoreKey<T>, value: T): void {
  const storage = area(key.backing);
  if (!storage) return;

  const write = () => storage.setItem(key.name, key.serialize(value));

  try {
    write();
  } catch {
    /**
     * Out of room, almost always. Something else in storage is disposable —
     * the restored query cache is the usual culprit and can always be
     * refetched — so it is dropped and the write is tried once more. State
     * the user chose should not be lost to a cache.
     */
    for (const reclaim of reclaimers) {
      try {
        reclaim();
      } catch {
        // A reclaimer that fails is no worse than one that isn't there
      }
    }

    try {
      write();
    } catch {
      // Storage is genuinely unavailable. The value still lives in the cache
      // for this session, so the app behaves — it just won't survive a reload.
    }
  }
}

/**
 * Registers something to drop when storage runs out.
 *
 * Caches register; state a person chose does not. Nothing here is called on a
 * successful write, so a registered handler costs nothing until the day it is
 * the difference between saving a setting and silently discarding it.
 */
export function onStorageFull(reclaim: () => void): () => void {
  reclaimers.add(reclaim);
  return () => {
    reclaimers.delete(reclaim);
  };
}

/** The current value. Same reference until something writes to this key. */
export function readStore<T>(key: StoreKey<T>): T {
  if (cache.has(key.name)) return cache.get(key.name) as T;

  const value = load(key);
  cache.set(key.name, value);
  return value;
}

/**
 * Writes a value and tells every reader.
 *
 * Accepts an updater, which is read against the shared value rather than a
 * component's copy of it — the difference between two dialogs both saving and
 * the second one overwriting the first.
 */
export function writeStore<T>(
  key: StoreKey<T>,
  value: T | ((previous: T) => T)
): T {
  const next =
    typeof value === 'function'
      ? (value as (previous: T) => T)(readStore(key))
      : value;

  cache.set(key.name, next);
  persist(key, next);
  notify(key.name);

  return next;
}

/** Forgets a value, returning readers to the fallback. */
export function removeStore<T>(key: StoreKey<T>): void {
  const storage = area(key.backing);

  try {
    storage?.removeItem(key.name);
  } catch {
    // Nothing to remove if storage is unavailable
  }

  cache.set(key.name, key.fallback);
  notify(key.name);
}

export function subscribeStore(name: string, listener: () => void): () => void {
  const set = listeners.get(name) ?? new Set();
  set.add(listener);
  listeners.set(name, set);

  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(name);
  };
}

/**
 * Picks up writes made in other tabs.
 *
 * The event does not fire in the tab that caused it, which is why writes here
 * notify directly. Dropping the cache rather than parsing the new value keeps
 * this cheap for keys nothing is currently reading.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    // A null key means the whole area was cleared
    if (event.key === null) {
      const names = [...cache.keys()];
      cache.clear();
      for (const name of names) notify(name);
      return;
    }

    if (!cache.has(event.key)) return;

    cache.delete(event.key);
    notify(event.key);
  });
}

/** Drops every cached value. For tests, which share a module instance. */
export function resetStoreCache(): void {
  const names = [...cache.keys()];
  cache.clear();
  for (const name of names) notify(name);
}
