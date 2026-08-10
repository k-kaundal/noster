import { useMemo, useRef } from 'react';
import { useStored } from '@/hooks/useStore';
import { defineKey } from '@/lib/store';

/**
 * State backed by localStorage.
 *
 * A thin binding over the shared store, which is the part that matters: this
 * used to keep a private copy per component, so two places reading one key
 * drifted apart the moment either of them wrote. Cross-tab sync is still here
 * and same-tab sync now works too — previously the `storage` event, which does
 * not fire in the tab that caused it, was the only thing keeping copies
 * aligned.
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  serializer?: {
    serialize: (value: T) => string;
    deserialize: (value: string) => T;
  }
) {
  // Both are written inline at most call sites, so a new identity each render
  // must not count as a different key
  const defaultRef = useRef(defaultValue);
  const serializerRef = useRef(serializer);

  const storeKey = useMemo(
    () =>
      defineKey<T>(key, defaultRef.current, {
        serialize: serializerRef.current?.serialize,
        deserialize: serializerRef.current?.deserialize,
      }),
    [key]
  );

  return useStored(storeKey);
}
