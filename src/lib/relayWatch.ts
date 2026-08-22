import type { NostrEvent, NostrFilter, NRelay } from '@nostrify/nostrify';
import { getRelayHealthMonitor } from '@/lib/relayHealth';

/**
 * Relay health, read from the traffic the app was already sending.
 *
 * The alternative was a prober: open a socket, time the handshake, close it.
 * That works and it is what the relays page uses, but running it app-wide
 * doubled every connection — a second socket to each relay, on top of the
 * pool's own, re-opened on a timer. On a list of eight relays where three are
 * refusing connections, that is three failing sockets becoming six, each with
 * its own retry, and a console full of `WebSocket connection ... failed`.
 *
 * Nothing here opens anything. A query that returns is a relay that works, a
 * query that throws is one that does not, and both facts were already being
 * produced by the feed. The prober stays for the relays page, where somebody
 * has explicitly asked "is this relay up?" and a real handshake is the answer.
 *
 * Timing is measured around the call rather than the handshake, so it includes
 * the relay's own think time. That is the number worth sorting on: a relay
 * that connects instantly and answers in four seconds is the slower relay.
 */
export function watchRelayHealth(relay: NRelay, url: string): NRelay {
  const monitor = getRelayHealthMonitor();

  const succeed = (startedAt: number) =>
    monitor.recordSuccess(url, Math.round(performance.now() - startedAt));

  /**
   * An abort is not a verdict.
   *
   * The app cancels constantly — a query is superseded, a component unmounts,
   * a timeout fires on the whole batch rather than on this relay. Counting
   * those as failures would open a circuit breaker on the fastest relay in
   * the set, because the fastest relay is the one still streaming when the
   * caller walks away.
   */
  const aborted = (error: unknown) =>
    error instanceof DOMException && error.name === 'AbortError';

  return {
    ...relay,

    async query(filters: NostrFilter[], opts?: { signal?: AbortSignal }) {
      const startedAt = performance.now();

      try {
        const events = await relay.query(filters, opts);
        succeed(startedAt);
        return events;
      } catch (error) {
        if (!aborted(error)) monitor.recordFailure(url);
        throw error;
      }
    },

    async event(event: NostrEvent, opts?: { signal?: AbortSignal }) {
      const startedAt = performance.now();

      try {
        await relay.event(event, opts);
        succeed(startedAt);
      } catch (error) {
        if (!aborted(error)) monitor.recordFailure(url);
        throw error;
      }
    },

    /**
     * Subscriptions report on their first message rather than at the end.
     *
     * A `REQ` left open for an hour is one call, and waiting for it to finish
     * before deciding whether the relay works means never deciding. The first
     * thing to arrive — an event, an EOSE, anything — is proof enough.
     */
    async *req(filters: NostrFilter[], opts?: { signal?: AbortSignal }) {
      const startedAt = performance.now();
      let reported = false;

      try {
        for await (const message of relay.req(filters, opts)) {
          if (!reported) {
            reported = true;
            succeed(startedAt);
          }
          yield message;
        }
      } catch (error) {
        if (!reported && !aborted(error)) monitor.recordFailure(url);
        throw error;
      }
    },
  } as NRelay;
}
