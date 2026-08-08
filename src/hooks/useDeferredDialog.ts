import { useEffect, useRef } from 'react';

/**
 * Helpers for dialogs that are always in the tree but almost never opened.
 *
 * A zap sheet, a login form, a quote composer — each one is mounted beside
 * every note in the feed, and each one used to be downloaded, parsed and
 * evaluated before the first note could be painted. Together with what they
 * pull in (a drawer library, a QR renderer) they were a sizeable share of the
 * first chunk, spent on screens most readers never open.
 *
 * The pair below makes that cost arrive at the right time instead: nothing on
 * first paint, fetched quietly once the page is idle, and mounted the moment
 * it is actually asked for.
 */

/**
 * True once `open` has been true, and true forever after.
 *
 * Gating a lazy dialog on `open` alone would unmount it on close, which throws
 * away its exit animation and whatever the person had typed. This keeps it
 * mounted once opened, so only the first open pays for anything.
 */
export function useOnceOpened(open: boolean): boolean {
  const opened = useRef(false);

  if (open) opened.current = true;

  return opened.current;
}

/**
 * Starts fetching a lazy chunk once the browser has nothing better to do.
 *
 * Without this, deferring a dialog trades a slow first paint for a stall
 * between the click and the dialog appearing — which reads as a broken button.
 * Prefetching on idle keeps the code off the critical path while still having
 * it in memory long before anyone reaches for it.
 */
export function useIdlePrefetch(load: () => Promise<unknown>): void {
  // Kept in a ref so an inline arrow at the call site doesn't re-run the effect
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let cancelled = false;
    const start = () => {
      if (!cancelled) void loader.current().catch(() => {});
    };

    // requestIdleCallback is missing on Safari; a timeout is the same idea
    // with worse timing, which is fine for something nobody is waiting on
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(start, { timeout: 4000 });
      return () => {
        cancelled = true;
        cancelIdleCallback(handle);
      };
    }

    const handle = setTimeout(start, 2000);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, []);
}
