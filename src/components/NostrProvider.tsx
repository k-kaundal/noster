import React, { useEffect, useRef } from 'react';
import { NostrEvent, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import type { RelayInfo } from '@/hooks/useRelayInfo';
import { NIP40, expirationOf, isExpired } from '@/lib/expiration';
import { createAuthHandler, type AuthPolicy } from '@/lib/nip42';
import { readRelays, writeRelays } from '@/lib/relay';
import {
  INDEXER_RELAYS,
  RECEIPT_RELAYS,
  canonicalTargets,
  isIdentityRequest,
  isZapReceiptRequest,
  withPrimaryFirst,
} from '@/lib/relayRouting';
import { getRelayHealthMonitor } from '@/lib/relayHealth';
import { ensureRelayHealth } from '@/lib/relayProbe';
import {
  RELAY_LIST_KIND,
  RELAY_LIST_SCOPE,
  authorsIn,
  relayHintsFor,
  rememberRelayLists,
  withAuthorHints,
} from '@/lib/outboxRouting';
import { remember } from '@/lib/eventStore';

/**
 * A pool that drops events whose moment has passed.
 *
 * NIP-40 asks clients to ignore expired events, and relays MAY keep serving
 * them — "MAY NOT delete expired messages immediately and MAY persist them
 * indefinitely" — so this cannot be left to the relays. Done at the pool
 * rather than in each hook because there are dozens of hooks and one of them
 * would eventually be written without it; here, an expired event never
 * reaches the application at all.
 *
 * Subclassed rather than wrapped so the result is still an `NPool`, and every
 * consumer that expects one keeps working.
 */
class ExpiryFilteringPool extends NPool {
  async query(
    ...args: Parameters<NPool['query']>
  ): Promise<NostrEvent[]> {
    const events = await super.query(...args);
    harvestRelayLists(events);
    return events.filter((event) => !isExpired(event));
  }

  async *req(...args: Parameters<NPool['req']>) {
    for await (const message of super.req(...args)) {
      // ["EVENT", <subscription id>, <event>]
      if (message[0] === 'EVENT') {
        const event = message[2] as NostrEvent;
        if (isExpired(event)) continue;
        harvestRelayLists([event]);
      }

      yield message;
    }
  }
}

/**
 * Relay lists seen since the last write, and the timer that will store them.
 *
 * Batched because a feed can carry several and each write is a transaction;
 * the routing table is already updated by then, so the delay costs nothing
 * but a few seconds of durability on a tab that closes immediately.
 */
let harvested: NostrEvent[] = [];
let harvestTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Notices where people publish, from events that were being fetched anyway.
 *
 * Every kind 10002 that crosses the pool — from a profile view, a relay-list
 * lookup, a feed that happens to carry one — makes the next read better
 * routed, at the cost of no extra request. The alternative is a bootstrap
 * that fetches relay lists for everyone you follow on login, which is a large
 * query at the worst possible moment.
 */
function harvestRelayLists(events: readonly NostrEvent[]): void {
  if (!rememberRelayLists(events)) return;

  harvested.push(...events.filter((event) => event.kind === RELAY_LIST_KIND));

  if (harvestTimer) return;

  harvestTimer = setTimeout(() => {
    harvestTimer = undefined;

    const batch = harvested;
    harvested = [];

    // Stored as they arrived. `mergeEvents` knows kind 10002 is replaceable,
    // so the newest list per author is what survives.
    void remember(RELAY_LIST_SCOPE, batch);
  }, 5000);
}

/**
 * Whether a relay is known to refuse expiring events.
 *
 * Read from whatever NIP-11 documents are already cached rather than fetched:
 * publishing must not wait on a request to every write relay, and many relays
 * serve their document without CORS headers so the answer often never arrives.
 * Unknown counts as supporting — declining to publish because a document could
 * not be read would block posting to most of the network.
 */
function refusesExpiry(queryClient: QueryClient, url: string): boolean {
  const info = queryClient.getQueryData<RelayInfo | null>(['relay-info', url]);
  const nips = info?.supported_nips;

  return Array.isArray(nips) && !nips.includes(NIP40);
}

interface NostrProviderProps {
  children: React.ReactNode;
}

/** Cap on relays contacted per request, so a long list can't stall a query. */
const MAX_READ_RELAYS = 10;
const MAX_WRITE_RELAYS = 8;

/**
 * How often the configured relays are re-checked.
 *
 * Comfortably longer than the prober's own minute-long cache, so this is a
 * heartbeat rather than a second source of truth about when to probe.
 */
const HEALTH_INTERVAL = 2 * 60_000;

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();

  const queryClient = useQueryClient();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  /**
   * Who to authenticate as, kept in a ref rather than closed over.
   *
   * The pool is built once and a relay may challenge at any moment after
   * that, including hours later — so the handler has to read the session as
   * it is when asked, not as it was when the pool was made. Filled in by
   * `AuthPolicyBridge` below, which can reach `useCurrentUser` because it
   * renders inside this provider.
   */
  const authPolicy = useRef<AuthPolicy>({ allowed: [], signer: null });

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

  /**
   * Keeps the router's idea of relay health from being fiction.
   *
   * `reqRouter` and `eventRouter` below sort by health and skip relays whose
   * circuit breaker is open, which is the right design and was doing nothing:
   * the only thing that probes relays is `lib/relayProbe`, and the only thing
   * that ran it was the relays page. So on every other screen — which is all
   * of them — every relay was `unknown`, the sort was arbitrary, and no
   * breaker had ever opened because no failure had ever been recorded.
   *
   * Probed here instead, where the relay list already lives. The prober caches
   * for a minute, shares a socket per relay and caps concurrency, so asking on
   * every relay change costs one short handshake per relay at most.
   */
  useEffect(() => {
    const urls = config.relays.map((relay) => relay.url).filter(Boolean);
    if (!urls.length) return;

    void ensureRelayHealth(urls);

    /*
     * Re-probed on an interval rather than once. A relay that failed early is
     * otherwise skipped for the life of the tab — the breaker reopens on its
     * own timeout, but nothing would ever record the success that clears the
     * failure count behind it.
     */
    const timer = setInterval(() => {
      void ensureRelayHealth(urls);
    }, HEALTH_INTERVAL);

    return () => clearInterval(timer);
  }, [relayKey, config.relays]);

  if (!pool.current) {
    const healthMonitor = getRelayHealthMonitor();

    pool.current = new ExpiryFilteringPool({
      open(url: string) {
        return new NRelay1(url, {
          // Configure reconnection with exponential backoff
          reconnectTimeout: 5000,   // Start with 5 second delay
          maxReconnectTime: 60000,  // Cap at 60 seconds
          requestTimeout: 3000,     // Timeout individual requests after 3 seconds
          /**
           * NIP-42. Nostrify drives the protocol; this decides whether to
           * answer at all, which it does only for relays the reader chose —
           * see `lib/nip42`.
           */
          auth: createAuthHandler(url, () => authPolicy.current),
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

        /**
         * Identity lookups also ask the indexers.
         *
         * Added rather than substituted, and only for kind 0 and kind 10002.
         * A general relay serves whichever revision of a replaceable profile
         * it happens to hold, which for someone who joined on another client
         * is often nothing or something years old — and the newest answer only
         * wins if somebody was asked who has it.
         */
        if (isIdentityRequest(filters)) {
          const withIndexers = canonicalTargets([...toQuery, ...INDEXER_RELAYS]);
          return new Map(withIndexers.map((url) => [url, filters]));
        }

        /**
         * A request purely about zap receipts asks where receipts actually go.
         *
         * The one case outbox routing cannot reach. A receipt is published by
         * the sender's lightning server to the relays named in the sender's
         * zap request — so it is neither the reader's choice nor the author's,
         * and the filter names no author to route by. A zap sent from another
         * client lands on that client's relays, and asking only the reader's
         * is how a paid creator reads a total lower than they were paid.
         *
         * Not capped by `MAX_READ_RELAYS`, deliberately: this fires only for
         * earnings totals and goal tallies, which are a handful of requests on
         * purpose-built screens rather than anything in a feed.
         */
        if (isZapReceiptRequest(filters)) {
          const wide = canonicalTargets([...toQuery, ...RECEIPT_RELAYS]);
          return new Map(wide.map((url) => [url, filters]));
        }

        /**
         * NIP-65. When the request names authors, some of the budget goes to
         * the relays those authors publish to.
         *
         * This is what stops the app being only as good as its own relay.
         * Someone who publishes to two relays of their own has always been
         * invisible here unless one of them happened to be in the reader's
         * list — not a bug in their setup, just the cost of asking the wrong
         * places. Their notes are found now because they are asked for where
         * they were put.
         *
         * The reader's own relays keep the rest of the budget rather than
         * being replaced: a published relay list can be years stale or point
         * at relays long gone, and trusting one exclusively turns a bad list
         * into an unreadable person.
         */
        const hints = relayHintsFor(authorsIn(filters));

        const routed = hints.length
          ? withAuthorHints(toQuery, hints, MAX_READ_RELAYS)
          : toQuery;

        return new Map(canonicalTargets(routed).map((url) => [url, filters]));
      },

      /**
       * Publish to the relays the user marked as write targets.
       * Prefers healthy relays for better publish reliability.
       */
      eventRouter(event: NostrEvent) {
        const allWriteRelays = canonicalTargets(writeRelays(relays.current));
        const primary = relayUrl.current;

        // Sort by health
        const healthySorted = healthMonitor.sortByHealth(allWriteRelays);
        const primaryFirst = withPrimaryFirst(healthySorted, primary);

        // Cap to MAX_WRITE_RELAYS
        const targets = primaryFirst.slice(0, MAX_WRITE_RELAYS);

        // Filter out relays with open circuit breakers
        const available = targets.filter((url) => healthMonitor.canQuery(url));
        const reachable = available.length > 0 ? available : targets.slice(0, 3);

        /**
         * "Clients SHOULD NOT send expiration events to relays that do not
         * support this NIP." Such a relay keeps and serves the event forever,
         * so the author would be promised a deletion that never happens.
         *
         * Only when the event actually expires, and never down to nothing: a
         * post held back entirely is worse than one held a while too long, so
         * if every write relay is known to refuse expiry, it goes anyway and
         * the composer is what warns about it.
         */
        if (expirationOf(event) === null) return reachable;

        const honouring = reachable.filter(
          (url) => !refusesExpiry(queryClient, url)
        );

        return honouring.length > 0 ? honouring : reachable;
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      <AuthPolicyBridge policy={authPolicy} />
      {children}
    </NostrContext.Provider>
  );
};

/**
 * Copies the current session into the ref the AUTH handler reads.
 *
 * Renders nothing. It exists because `useCurrentUser` needs the pool — a
 * bunker signer talks over it — so the provider cannot call it directly
 * without a cycle. A child can, and a ref carries the answer back up.
 */
function AuthPolicyBridge({
  policy,
}: {
  policy: React.MutableRefObject<AuthPolicy>;
}) {
  const { user } = useCurrentUser();
  const { config } = useAppContext();

  policy.current = {
    allowed: config.relays.map((relay) => relay.url),
    /**
     * A borrowed key cannot sign, and asking it to would surface a failure
     * from somewhere the reader never chose to act.
     */
    signer: user && !user.readOnly ? user.signer : null,
  };

  return null;
}

export default NostrProvider;
