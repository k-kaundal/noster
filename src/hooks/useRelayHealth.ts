import { useCallback, useEffect, useRef, useState } from 'react';

export type RelayHealthStatus = 'idle' | 'checking' | 'online' | 'offline';

export interface RelayHealth {
  status: RelayHealthStatus;
  /** Round-trip time of the websocket handshake, in milliseconds. */
  latency?: number;
  checkedAt?: number;
  error?: string;
}

const CONNECT_TIMEOUT = 6000;

/** Opens a websocket purely to time the handshake, then closes it. */
function probeRelay(url: string): Promise<RelayHealth> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let socket: WebSocket;

    try {
      socket = new WebSocket(url);
    } catch (error) {
      resolve({
        status: 'offline',
        checkedAt: Date.now(),
        error: (error as Error)?.message ?? 'Invalid relay URL',
      });
      return;
    }

    const finish = (health: RelayHealth) => {
      clearTimeout(timer);
      socket.onopen = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Already closing — nothing to clean up
      }
      resolve(health);
    };

    const timer = setTimeout(
      () =>
        finish({
          status: 'offline',
          checkedAt: Date.now(),
          error: 'Timed out',
        }),
      CONNECT_TIMEOUT
    );

    socket.onopen = () =>
      finish({
        status: 'online',
        latency: Math.round(performance.now() - startedAt),
        checkedAt: Date.now(),
      });

    socket.onerror = () =>
      finish({
        status: 'offline',
        checkedAt: Date.now(),
        error: 'Connection failed',
      });
  });
}

/**
 * Tracks reachability and handshake latency for a set of relays. Probes run on
 * mount and whenever the URL list changes, and can be re-run on demand.
 */
export function useRelayHealth(urls: string[]) {
  const [health, setHealth] = useState<Record<string, RelayHealth>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(async (targets: string[]) => {
    if (!targets.length) return;

    setHealth((prev) => {
      const next = { ...prev };
      for (const url of targets) {
        next[url] = { ...next[url], status: 'checking' };
      }
      return next;
    });

    await Promise.all(
      targets.map(async (url) => {
        const result = await probeRelay(url);
        if (!mounted.current) return;
        setHealth((prev) => ({ ...prev, [url]: result }));
      })
    );
  }, []);

  // A stable key so the effect doesn't refire on a new array of same URLs
  const key = urls.join(',');

  useEffect(() => {
    const targets = key ? key.split(',') : [];
    check(targets);
  }, [key, check]);

  const refresh = useCallback(() => {
    check(key ? key.split(',') : []);
  }, [key, check]);

  return { health, refresh, check };
}
