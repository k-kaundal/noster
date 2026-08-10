import { useCallback, useSyncExternalStore } from 'react';
import { defineKey, readStore, subscribeStore, writeStore } from '@/lib/store';
import { withNickname, type AccountLabels } from '@/lib/accounts';

/**
 * Not namespaced by account, deliberately: this is the map *between* accounts,
 * so scoping it to one of them would make each account able to see only its
 * own name and the switcher unable to label anything but the current row.
 */
const LABELS = defineKey<AccountLabels>('accounts:nicknames', {});

/**
 * Private names for your own accounts.
 *
 * Local to this browser and never published — the point is to tell a main
 * account from an alt in a menu, not to announce to Nostr which is which.
 */
export function useAccountLabels() {
  const subscribe = useCallback(
    (listener: () => void) => subscribeStore(LABELS.name, listener),
    []
  );

  const labels = useSyncExternalStore(
    subscribe,
    () => readStore(LABELS),
    () => LABELS.fallback
  );

  const rename = useCallback((pubkey: string, nickname: string) => {
    writeStore(LABELS, (previous) => withNickname(previous, pubkey, nickname));
  }, []);

  return { labels, rename };
}
