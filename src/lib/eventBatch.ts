/**
 * A holding pen between the relays and the cache.
 *
 * A live subscription delivers one event per message, and the obvious thing to
 * do with each is write it straight into the store. That is fine on a quiet
 * feed and pathological on a busy one: every write notifies every subscriber,
 * so a global feed carrying a few hundred events a second asks React to render
 * a few hundred times a second, each render doing the filtering, sorting and
 * muting the feed does on every pass. The page does not fall behind gradually
 * — it stops responding, because the main thread never gets a gap.
 *
 * Batching turns that into one write per window. The events still arrive at
 * the same rate; they are simply handed over in groups, which is all the store
 * and the view ever needed.
 *
 * Deliberately not a React hook and deliberately not tied to Nostr — it
 * schedules and deduplicates, nothing else, so it can be tested without a
 * relay, a component tree or a clock.
 */

export interface EventBatcherOptions<T> {
  /** What identifies an item, so the same one arriving twice is one item. */
  key: (item: T) => string;
  /** Called with each batch, newest first if `compare` says so. */
  onFlush: (items: T[]) => void;
  /**
   * How long to hold items before handing them over. Long enough to collect a
   * burst, short enough that a quiet feed still feels immediate.
   */
  intervalMs?: number;
  /**
   * Flush early once this many are waiting. A burst big enough to matter
   * should not also wait out the timer.
   */
  maxBatch?: number;
  /**
   * The most to hold at once. Past this the *oldest* waiting items are
   * dropped: the point of the buffer is what just happened, and a reader who
   * has been away from a firehose for a minute wants the last few seconds of
   * it rather than a minute of backlog rendered all at once.
   */
  maxBuffer?: number;
  /** Ordering within a batch. Left off, insertion order is kept. */
  compare?: (a: T, b: T) => number;
  /** Injected for tests. Defaults to `setTimeout`. */
  schedule?: (callback: () => void, ms: number) => number;
  cancel?: (handle: number) => void;
}

export interface EventBatcher<T> {
  push(item: T): void;
  /** Hands over whatever is waiting, now. */
  flush(): void;
  /** Stops the timer and drops anything unflushed. */
  dispose(): void;
  /** How many are waiting. For tests and diagnostics. */
  readonly size: number;
  /** How many were dropped for being older than the buffer allows. */
  readonly dropped: number;
}

export const DEFAULT_BATCH_INTERVAL_MS = 250;
export const DEFAULT_MAX_BATCH = 50;
export const DEFAULT_MAX_BUFFER = 500;

export function createEventBatcher<T>(
  options: EventBatcherOptions<T>
): EventBatcher<T> {
  const {
    key,
    onFlush,
    intervalMs = DEFAULT_BATCH_INTERVAL_MS,
    maxBatch = DEFAULT_MAX_BATCH,
    maxBuffer = DEFAULT_MAX_BUFFER,
    compare,
    schedule = (callback, ms) =>
      setTimeout(callback, ms) as unknown as number,
    cancel = (handle) => clearTimeout(handle),
  } = options;

  /**
   * Keyed, so the same event arriving from four relays is one entry.
   *
   * This is the first of two deduplication passes and it is not the important
   * one — the store still has to check what it already holds. It is here
   * because multi-relay replication means duplicates are the common case, not
   * the exception, and a batch of forty that is really ten distinct events
   * should be handed over as ten.
   */
  let pending = new Map<string, T>();
  let timer: number | null = null;
  let dropped = 0;
  let disposed = false;

  function stop() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  function flush() {
    stop();
    if (!pending.size) return;

    const items = [...pending.values()];
    pending = new Map();

    onFlush(compare ? items.sort(compare) : items);
  }

  return {
    push(item: T) {
      if (disposed) return;

      const id = key(item);

      /*
       * A repeat keeps its place in the queue rather than jumping to the back.
       * Order within a batch should reflect when something was first seen, not
       * which relay was slowest to repeat it.
       */
      if (!pending.has(id)) {
        pending.set(id, item);
      }

      if (pending.size > maxBuffer) {
        // Map iterates in insertion order, so the first key is the oldest
        const oldest = pending.keys().next();
        if (!oldest.done) {
          pending.delete(oldest.value);
          dropped += 1;
        }
      }

      if (pending.size >= maxBatch) {
        flush();
        return;
      }

      if (timer === null) {
        timer = schedule(() => {
          timer = null;
          flush();
        }, intervalMs);
      }
    },

    flush,

    dispose() {
      disposed = true;
      stop();
      pending = new Map();
    },

    get size() {
      return pending.size;
    },

    get dropped() {
      return dropped;
    },
  };
}
