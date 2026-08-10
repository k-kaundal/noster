import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  ensureRelayHealth,
  getRelayHealthSnapshot,
  subscribeToRelayHealth,
} from '@/lib/relayProbe';

export type {
  RelayHealth,
  RelayHealthStatus,
} from '@/lib/relayProbe';

/**
 * Reachability and handshake latency for a set of relays.
 *
 * A view onto one shared cache rather than a probe of its own. Several of
 * these are mounted at once — the header dot, the relay switcher beside it,
 * the copy in the mobile sheet, the one in the account menu, and one more in
 * every empty feed — and each opening its own socket to every relay is what
 * filled the network panel with duplicate connections.
 *
 * Mounting now costs nothing while a recent answer exists, so the only sockets
 * left are the pool's own, plus one short-lived probe per relay per minute.
 */
export function useRelayHealth(urls: string[]) {
  const health = useSyncExternalStore(
    subscribeToRelayHealth,
    getRelayHealthSnapshot,
    getRelayHealthSnapshot
  );

  // A stable key, so the effect doesn't refire on a new array of same URLs
  const key = urls.join(',');

  useEffect(() => {
    if (key) void ensureRelayHealth(key.split(','));
  }, [key]);

  const refresh = useCallback(() => {
    if (key) void ensureRelayHealth(key.split(','), { force: true });
  }, [key]);

  const check = useCallback((targets: string[]) => {
    return ensureRelayHealth(targets, { force: true });
  }, []);

  return { health, refresh, check };
}
