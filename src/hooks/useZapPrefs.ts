import { useCallback, useMemo } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import {
  DEFAULT_ZAP_PREFS,
  readZapPrefs,
  type ZapPrefs,
} from '@/lib/zapPrefs';

/**
 * How this person wants to zap.
 *
 * Kept on the device rather than published. It is a preference about this
 * app's buttons, not a fact about the reader that other clients should act on
 * — and the amount somebody habitually sends is nobody else's business.
 */
export function useZapPrefs() {
  const [stored, setStored] = useLocalStorage<unknown>(
    'nostrfeed:zap-prefs',
    DEFAULT_ZAP_PREFS
  );

  // Repaired on read: storage is edited by hand and survives releases
  const prefs = useMemo(() => readZapPrefs(stored), [stored]);

  const update = useCallback(
    (patch: Partial<ZapPrefs>) => {
      setStored((current) => ({ ...readZapPrefs(current), ...patch }));
    },
    [setStored]
  );

  return { prefs, update };
}
