import React, { useEffect, useRef } from 'react';
import { NostrEvent, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';
import { readRelays, writeRelays } from '@/lib/relay';
import { canonicalTargets, withPrimaryFirst } from '@/lib/relayRouting';
import { getRelayHealthMonitor } from '@/lib/relayHealth';

interface NostrProviderProps {
  children: React.ReactNode;
}

/** Cap on relays contacted per request, so a long list can't stall a query. */
const MAX_READ_RELAYS = 10;
const MAX_WRITE_RELAYS = 8;

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();

  const queryClient = useQueryClient();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  // Refs keep the routers reading current config without rebuilding the pool
  const relayUrl = useRef<string>(config.relayUrl);
  const relays = useRef(config.relays);

  relayUrl.current = config.relayUrl;
  relays.current = config.relays;

  // Cached results belong to the previous relay set, so they are dropped
  const relayKey = config.relays
    .map((relay) => `${relay.url}:${relay.read ? 'r' : ''}${relay.write ? 'w' : ''}`)
    .join(',');

  /**
   * The relay set at the time the cache was filled.
   *
   * Compared rather than reacted to, because this effect also runs on mount —
   * and on mount there is nothing stale to clear, only the cache restored from
   * the last visit, which resetting would throw away before it could be shown.
   */
  const cachedRelayKey = useRef(relayKey);

  useEffect(() => {
    if (cachedRelayKey.current === relayKey) return;

    cachedRelayKey.current = relayKey;
    queryClient.resetQueries();
  }, [relayKey, queryClient]);

  if (!pool.current) {
    const healthMonitor = getRelayHealthMonitor();

    pool.current = new NPool({
      open(url: string) {
        return new NRelay1(url, {
          // Configure reconnection with exponential backoff
          reconnectTimeout: 5000,   // Start with 5 second delay
          maxReconnectTime: 60000,  // Cap at 60 seconds
          requestTimeout: 3000,     // Timeout individual requests after 3 seconds
        });
      },
      /**
       * Fan the same filters out to every read relay. NPool merges and
       * deduplicates the responses, so the feed is the union of all of them
       * rather than whatever a single relay happens to hold.
       *
       * Uses health-aware relay selection to prefer healthy relays.
       */
      reqRouter(filters) {
        const allReadRelays = canonicalTargets(readRelays(relays.current));
        const primary = relayUrl.current;

        // Sort by health to prefer healthy relays
        const healthySorted = healthMonitor.sortByHealth(allReadRelays);
        const primaryFirst = withPrimaryFirst(healthySorted, primary);

        // Cap to MAX_READ_RELAYS to prevent query stalling
        const targets = primaryFirst.slice(0, MAX_READ_RELAYS);

        // Filter out relays with open circuit breakers
        const available = targets.filter((url) => healthMonitor.canQuery(url));

        // If all relays have circuit breakers open, use them anyway as last resort
        const toQuery = available.length > 0 ? available : targets.slice(0, 3);

        return new Map(toQuery.map((url) => [url, filters]));
      },

      /**
       * Publish to the relays the user marked as write targets.
       * Prefers healthy relays for better publish reliability.
       */
      eventRouter(_event: NostrEvent) {
        const allWriteRelays = canonicalTargets(writeRelays(relays.current));
        const primary = relayUrl.current;

        // Sort by health
        const healthySorted = healthMonitor.sortByHealth(allWriteRelays);
        const primaryFirst = withPrimaryFirst(healthySorted, primary);

        // Cap to MAX_WRITE_RELAYS
        const targets = primaryFirst.slice(0, MAX_WRITE_RELAYS);

        // Filter out relays with open circuit breakers
        const available = targets.filter((url) => healthMonitor.canQuery(url));

        return available.length > 0 ? available : targets.slice(0, 3);
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;
