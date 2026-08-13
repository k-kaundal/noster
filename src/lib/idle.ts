/**
 * Work that should happen, but not now.
 *
 * Background prefetching exists to make the *next* thing instant, so doing it
 * while the current thing is still painting defeats the point — a fetch fired
 * during the first render competes for the same main thread and the same
 * relay connections as the feed somebody is waiting to read.
 *
 * `requestIdleCallback` is the right primitive and is not everywhere: Safari
 * only shipped it recently and jsdom has never had it. The fallback is a
 * timer, which is worse at picking the moment and identical in effect.
 */

type IdleHandle = { cancel: () => void };

interface IdleWindow {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number }
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/**
 * Runs `task` once the browser is not busy, or after `timeoutMs` regardless.
 *
 * The timeout is not a nicety. Without one, a page that never goes idle —
 * which is any page with an animation on it — never runs the callback at all,
 * and the prefetch that was meant to make a tab instant simply never happens.
 */
export function runWhenIdle(task: () => void, timeoutMs = 2000): IdleHandle {
  const scope = globalThis as unknown as IdleWindow;

  if (typeof scope.requestIdleCallback === 'function') {
    const handle = scope.requestIdleCallback(task, { timeout: timeoutMs });

    return {
      cancel: () => scope.cancelIdleCallback?.(handle),
    };
  }

  const handle = setTimeout(task, timeoutMs);
  return { cancel: () => clearTimeout(handle) };
}
