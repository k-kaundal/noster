import React, { useEffect, useRef } from 'react';
import { NostrEvent, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';
import { readRelays, writeRelays } from '@/lib/relay';

interface NostrProviderProps {
  children: React.ReactNode;
}

/** Cap on relays contacted per request, so a long list can't stall a query. */
const MAX_READ_RELAYS = 8;
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

  useEffect(() => {
    queryClient.resetQueries();
  }, [relayKey, queryClient]);

  if (!pool.current) {
    pool.current = new NPool({
      open(url: string) {
        return new NRelay1(url);
      },
      /**
       * Fan the same filters out to every read relay. NPool merges and
       * deduplicates the responses, so the feed is the union of all of them
       * rather than whatever a single relay happens to hold.
       */
      reqRouter(filters) {
        const urls = readRelays(relays.current);
        const targets = (urls.length ? urls : [relayUrl.current]).slice(
          0,
          MAX_READ_RELAYS
        );
        return new Map(targets.map((url) => [url, filters]));
      },
      /** Publish to the relays the user marked as write targets. */
      eventRouter(_event: NostrEvent) {
        const urls = writeRelays(relays.current);
        const targets = urls.length ? urls : [relayUrl.current];
        return [...new Set(targets)].slice(0, MAX_WRITE_RELAYS);
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
