export type RelayHealthStatus = 'idle' | 'checking' | 'online' | 'offline';

export interface RelayHealth {
  status: RelayHealthStatus;
  /** Round-trip time of the websocket handshake, in milliseconds. */
  latency?: number;
  checkedAt?: number;
  error?: string;
}

/**
 * One shared answer to "is this relay up?".
 *
 * The header, the account menu and every empty state all show relay health,
 * and each of them used to open its own websocket to every relay to find out.
 * Six relays behind four mounted components is twenty-four sockets opened to
 * answer one question — on top of the pool's own connection to each of them,
 * which is the one actually carrying the app's traffic.
 *
 * So the probe lives here instead of in the hook: results are cached, requests
 * for the same relay share a socket, and a fresh answer is only fetched once
 * the last one has aged out.
 */

/** How long an answer stays good. A relay does not go down every 10 seconds. */
const TTL = 60_000;

/** Handshake budget. Past this the relay is unusable even if it is alive. */
const CONNECT_TIMEOUT = 6_000;

/** Sockets opened at once, so a long relay list doesn't arrive as a burst. */
const MAX_CONCURRENT = 4;

const cache = new Map<string, RelayHealth>();
const inFlight = new Map<string, Promise<RelayHealth>>();
const listeners = new Set<() => void>();

/**
 * Frozen view of the cache.
 *
 * Rebuilt only when something changes: `useSyncExternalStore` compares
 * snapshots by identity and will loop forever if handed a new object each
 * time it asks.
 */
let snapshot: Record<string, RelayHealth> = {};

function publish(): void {
  snapshot = Object.fromEntries(cache);
  for (const listener of listeners) listener();
}

function set(url: string, health: RelayHealth): void {
  cache.set(url, health);
  publish();
}

export function subscribeToRelayHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRelayHealthSnapshot(): Record<string, RelayHealth> {
  return snapshot;
}

/** Opens a websocket purely to time the handshake, then closes it. */
function probe(url: string): Promise<RelayHealth> {
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
        finish({ status: 'offline', checkedAt: Date.now(), error: 'Timed out' }),
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

function isStale(url: string, now: number): boolean {
  const cached = cache.get(url);
  return !cached?.checkedAt || now - cached.checkedAt > TTL;
}

async function runProbe(url: string): Promise<RelayHealth> {
  set(url, { ...cache.get(url), status: 'checking' });

  const result = await probe(url);
  inFlight.delete(url);
  set(url, result);

  return result;
}

/**
 * Makes sure each URL has a recent answer, opening as few sockets as possible.
 *
 * A relay already being checked is joined rather than probed again, and one
 * whose last answer is still fresh is left alone. `force` is for the relays
 * page, where someone has explicitly asked to re-test.
 */
export function ensureRelayHealth(
  urls: string[],
  options: { force?: boolean } = {}
): Promise<void> {
  const wanted = [...new Set(urls.filter(Boolean))];
  if (!wanted.length) return Promise.resolve();

  // A browser that knows it is offline can answer without opening anything
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    for (const url of wanted) {
      set(url, { status: 'offline', checkedAt: Date.now(), error: 'Offline' });
    }
    return Promise.resolve();
  }

  const now = Date.now();
  const joins: Array<Promise<unknown>> = [];
  const todo: string[] = [];

  for (const url of wanted) {
    const existing = inFlight.get(url);

    if (existing) {
      joins.push(existing);
    } else if (options.force || isStale(url, now)) {
      todo.push(url);
    }
  }

  const pump = (async () => {
    for (let i = 0; i < todo.length; i += MAX_CONCURRENT) {
      const batch = todo.slice(i, i + MAX_CONCURRENT).map((url) => {
        const running = runProbe(url);
        inFlight.set(url, running);
        return running;
      });

      await Promise.all(batch);
    }
  })();

  return Promise.all([...joins, pump]).then(() => undefined);
}

/** Drops every cached answer. Used by tests and by relay-list changes. */
export function resetRelayHealth(): void {
  cache.clear();
  inFlight.clear();
  publish();
}
