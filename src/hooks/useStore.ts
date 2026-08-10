import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  defineKey,
  readStore,
  subscribeStore,
  writeStore,
  type StoreBacking,
  type StoreKey,
} from '@/lib/store';

/**
 * Binds a component to a stored value.
 *
 * Every component on the same key sees the same value and re-renders together,
 * because they are reading one cache rather than each keeping a copy taken
 * whenever they happened to mount.
 */
export function useStored<T>(
  key: StoreKey<T>
): readonly [T, (value: T | ((previous: T) => T)) => void] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeStore(key.name, listener),
    [key.name]
  );

  const snapshot = useCallback(() => readStore(key), [key]);

  const value = useSyncExternalStore(subscribe, snapshot, () => key.fallback);

  const set = useCallback(
    (next: T | ((previous: T) => T)) => {
      writeStore(key, next);
    },
    [key]
  );

  return [value, set] as const;
}

/**
 * A stored value that belongs to one Nostr identity.
 *
 * Which feed tab you were on, what you had half-written, what you last
 * expanded — none of it should follow you into somebody else's account when
 * they sign in on the same browser, and none of it should be lost when you
 * switch back. Namespacing by pubkey gives both.
 *
 * Signed out has its own namespace rather than no storage, so the choice
 * someone makes before logging in survives the page they make it on.
 */
export function useAccountStored<T>(
  name: string,
  fallback: T,
  options: { backing?: StoreBacking } = {}
): readonly [T, (value: T | ((previous: T) => T)) => void] {
  const { user } = useCurrentUser();
  const scope = user?.pubkey ?? 'anon';
  const { backing } = options;

  /**
   * Held in a ref because a fallback is usually written inline — `[]`, `{}`,
   * `''` — and a new object each render would otherwise redefine the key on
   * every render. It is only ever read once per key anyway: it is the value
   * for a key that has never been written.
   */
  const fallbackRef = useRef(fallback);

  const key = useMemo(
    () => defineKey<T>(`${name}:${scope}`, fallbackRef.current, { backing }),
    [name, scope, backing]
  );

  return useStored(key);
}
