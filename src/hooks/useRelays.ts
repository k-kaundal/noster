import { useCallback } from 'react';
import { useAppContext } from '@/hooks/useAppContext';
import {
  dedupeRelays,
  isValidRelayUrl,
  normalizeRelayUrl,
  readRelays,
  writeRelays,
  type RelayEntry,
} from '@/lib/relay';

/** Reads and mutates the relay set stored in app config. */
export function useRelays() {
  const { config, updateConfig, presetRelays = [] } = useAppContext();
  const relays = config.relays;

  const setRelays = useCallback(
    (next: RelayEntry[]) => {
      const entries = dedupeRelays(next);

      updateConfig((current) => ({
        ...current,
        relays: entries,
        // The primary must stay part of the set, so it follows any removal
        relayUrl: entries.some((relay) => relay.url === current.relayUrl)
          ? current.relayUrl
          : entries[0]?.url ?? current.relayUrl,
      }));
    },
    [updateConfig]
  );

  const addRelay = useCallback(
    (url: string, opts: { read?: boolean; write?: boolean } = {}) => {
      if (!isValidRelayUrl(url)) return false;
      const normalized = normalizeRelayUrl(url);

      if (relays.some((relay) => relay.url === normalized)) return false;

      setRelays([
        ...relays,
        { url: normalized, read: opts.read ?? true, write: opts.write ?? true },
      ]);
      return true;
    },
    [relays, setRelays]
  );

  const removeRelay = useCallback(
    (url: string) => {
      // Removing the last relay would leave nothing to query
      if (relays.length <= 1) return false;
      setRelays(relays.filter((relay) => relay.url !== url));
      return true;
    },
    [relays, setRelays]
  );

  const toggleMode = useCallback(
    (url: string, mode: 'read' | 'write', value: boolean) => {
      setRelays(
        relays.map((relay) =>
          relay.url === url ? { ...relay, [mode]: value } : relay
        )
      );
    },
    [relays, setRelays]
  );

  const setPrimary = useCallback(
    (url: string) => {
      updateConfig((current) => ({ ...current, relayUrl: url }));
    },
    [updateConfig]
  );

  /** Replaces the whole set, e.g. when importing a published NIP-65 list. */
  const replaceAll = useCallback(
    (entries: RelayEntry[]) => {
      if (!entries.length) return;
      setRelays(entries);
    },
    [setRelays]
  );

  /** Preset relays the user hasn't added yet, for one-tap suggestions. */
  const suggestions = presetRelays
    .map((preset) => ({ ...preset, url: normalizeRelayUrl(preset.url) }))
    .filter(
      (preset) =>
        preset.url && !relays.some((relay) => relay.url === preset.url)
    );

  return {
    relays,
    primaryUrl: config.relayUrl,
    readUrls: readRelays(relays),
    writeUrls: writeRelays(relays),
    suggestions,
    addRelay,
    removeRelay,
    toggleMode,
    setPrimary,
    replaceAll,
    setRelays,
  };
}
