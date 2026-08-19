/**
 * Asking a relay how many, instead of fetching them all and counting.
 *
 * NIP-45: the client sends `["COUNT", <subId>, <filter…>]` and the relay
 * answers `["COUNT", <subId>, {"count": n}]`. One frame, whatever the answer
 * is — where the alternative is downloading every matching event, which for a
 * follower count means thousands of contact lists, most of them arriving only
 * to be discarded.
 *
 * Deliberately written against the raw protocol rather than through the pool.
 * A COUNT is a different verb, it is answered by exactly one relay, and the
 * failure that matters is a relay that ignores it — which is a timeout, not an
 * error. Every caller must have something to fall back to.
 */

/** The relay's answer. `approximate` is the relay admitting it estimated. */
export interface RelayCount {
  count: number;
  approximate: boolean;
}

/** What a relay frame turned out to be, once read. */
export type CountFrame =
  | { type: 'count'; count: number; approximate: boolean }
  | { type: 'closed'; reason: string }
  | { type: 'notice'; reason: string }
  | null;

/**
 * Reads one frame from a relay, keeping only what answers this subscription.
 *
 * Anything else — an EVENT from another subscription, an EOSE, a frame that is
 * not JSON at all — is `null`, meaning "not for me, keep waiting". Treating an
 * unparseable frame as a failure would let one stray message from an unrelated
 * subscription cancel a perfectly good count.
 */
export function parseCountFrame(raw: unknown, subId: string): CountFrame {
  if (typeof raw !== 'string') return null;

  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(message)) return null;

  const [verb, id, payload] = message as [unknown, unknown, unknown];

  /*
   * A NOTICE carries no subscription id, so it cannot be matched to this
   * request. Reported rather than acted on: relays send them for all sorts of
   * reasons, and cancelling on one would make counts fail for unrelated chatter.
   */
  if (verb === 'NOTICE') {
    return { type: 'notice', reason: typeof id === 'string' ? id : '' };
  }

  if (id !== subId) return null;

  if (verb === 'CLOSED') {
    return { type: 'closed', reason: typeof payload === 'string' ? payload : '' };
  }

  if (verb !== 'COUNT') return null;

  if (!payload || typeof payload !== 'object') return null;

  const { count, approximate } = payload as {
    count?: unknown;
    approximate?: unknown;
  };

  // A relay that answers COUNT with no number has told us nothing usable
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
    return null;
  }

  return {
    type: 'count',
    count: Math.floor(count),
    approximate: approximate === true,
  };
}

/** A filter, in the shape NIP-01 defines. Only what COUNT is ever asked for. */
export interface CountFilter {
  kinds?: number[];
  authors?: string[];
  ids?: string[];
  since?: number;
  until?: number;
  [tag: `#${string}`]: string[] | number[] | number | undefined;
}

/** Just enough of a websocket to send one message and read the replies. */
export interface CountSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
  addEventListener(type: 'open' | 'error' | 'close', handler: () => void): void;
  readyState: number;
}

export interface CountOptions {
  /** How long to wait before giving up and letting the caller fall back. */
  timeout?: number;
  signal?: AbortSignal;
  /** Injected in tests; defaults to the platform `WebSocket`. */
  connect?: (url: string) => CountSocket;
}

const OPEN = 1;
const DEFAULT_TIMEOUT = 4000;

let counter = 0;

/**
 * Asks one relay for a count, or gives up.
 *
 * Resolves `null` rather than rejecting on every ordinary disappointment: a
 * relay that does not implement NIP-45, one that closes the subscription, one
 * that simply never answers. All three mean the same thing to a caller — use
 * the slow path — and forcing each of them through a catch block is how a
 * missing feature turns into a broken screen.
 */
export async function countEvents(
  url: string,
  filters: CountFilter[],
  options: CountOptions = {}
): Promise<RelayCount | null> {
  const connect =
    options.connect ??
    ((target: string) => new WebSocket(target) as unknown as CountSocket);

  const subId = `count-${(counter = (counter + 1) % 1_000_000)}`;
  const frame = JSON.stringify(['COUNT', subId, ...filters]);

  let socket: CountSocket;
  try {
    socket = connect(url);
  } catch {
    return null;
  }

  return new Promise<RelayCount | null>((resolve) => {
    let done = false;

    const finish = (result: RelayCount | null) => {
      if (done) return;
      done = true;

      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);

      /*
       * Closed by us, always. A COUNT subscription that is never closed stays
       * open on the relay until it drops the connection, and this app opens
       * one per follower count on screen.
       */
      try {
        socket.close();
      } catch {
        // Already closing, or never opened. Either way there is nothing to do.
      }

      resolve(result);
    };

    const abort = () => finish(null);

    const timer = setTimeout(
      () => finish(null),
      options.timeout ?? DEFAULT_TIMEOUT
    );

    if (options.signal?.aborted) {
      finish(null);
      return;
    }
    options.signal?.addEventListener('abort', abort);

    const send = () => {
      try {
        socket.send(frame);
      } catch {
        finish(null);
      }
    };

    socket.addEventListener('message', (event) => {
      const parsed = parseCountFrame(event.data, subId);
      if (!parsed) return;

      if (parsed.type === 'count') {
        finish({ count: parsed.count, approximate: parsed.approximate });
        return;
      }

      // A CLOSED naming this subscription is the relay declining, definitively
      if (parsed.type === 'closed') finish(null);
    });

    socket.addEventListener('error', () => finish(null));
    socket.addEventListener('close', () => finish(null));

    if (socket.readyState === OPEN) {
      send();
    } else {
      socket.addEventListener('open', send);
    }
  });
}
