/**
 * Registers the service worker, notices when a new one is waiting, and decides
 * whether to take it now or offer it.
 *
 * The worker never activates itself — see the comment in `sw.js` about why
 * swapping under a running page breaks it. So taking an update is always this
 * module's decision, and there are two ways it happens: silently, when the app
 * has been in the background and is being returned to, or by asking, when
 * somebody is in the middle of using it.
 */

type UpdateListener = (ready: boolean) => void;

const listeners = new Set<UpdateListener>();

let registration: ServiceWorkerRegistration | null = null;
let waiting: ServiceWorker | null = null;
let reloading = false;

/**
 * How often to ask whether a new build exists.
 *
 * The browser's own schedule is roughly daily and tied to navigation, which
 * for an installed app that is never navigated and rarely closed means an
 * update can sit unnoticed for days. Half an hour is frequent enough that a
 * fix ships the same session and rare enough to be free — the request is
 * conditional and answers 304 when nothing has changed.
 */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * How long away counts as having left.
 *
 * The threshold for applying an update without asking. Under it somebody
 * glanced at a notification and came back to what they were doing, and
 * reloading would take a half-written reply with it. Over it they left, and
 * are arriving at a fresh screen where a reload costs nothing and is
 * indistinguishable from a cold start.
 */
const AWAY_MS = 60 * 1000;

let hiddenAt: number | null = null;

function announce(): void {
  for (const listener of listeners) listener(!!waiting);
}

export function subscribeToUpdates(listener: UpdateListener): () => void {
  listeners.add(listener);
  listener(!!waiting);

  return () => {
    listeners.delete(listener);
  };
}

/** Whether an update is sitting ready. */
export function hasUpdate(): boolean {
  return !!waiting;
}

/** Accepts the update: activate the new worker, then reload onto it. */
export function applyUpdate(): void {
  if (!waiting) return;

  waiting.postMessage('SKIP_WAITING');
}

/** Asks the network whether a newer worker exists. Cheap, and safe to repeat. */
export function checkForUpdate(): void {
  // `update()` rejects when offline, which is not a problem worth surfacing
  registration?.update().catch(() => {});
}

function markWaiting(worker: ServiceWorker): void {
  waiting = worker;
  announce();

  /*
   * If the app is already in the background when the update lands, take it
   * now rather than waiting to be asked. Nobody is looking at the page, so
   * the reload is free, and they come back to the new version instead of a
   * strip about it.
   */
  if (document.visibilityState === 'hidden') applyUpdate();
}

function watch(target: ServiceWorkerRegistration): void {
  registration = target;

  // Already waiting when the page loaded — a tab opened after a deploy
  if (target.waiting && navigator.serviceWorker.controller) {
    markWaiting(target.waiting);
  }

  target.addEventListener('updatefound', () => {
    const installing = target.installing;
    if (!installing) return;

    installing.addEventListener('statechange', () => {
      /**
       * `installed` with a controller present means an update. Without one it
       * is the very first install, which needs no announcement — the page is
       * already running the code that was just cached.
       */
      if (
        installing.state === 'installed' &&
        navigator.serviceWorker.controller
      ) {
        markWaiting(installing);
      }
    });
  });
}

/**
 * Keeps the app current without anyone having to think about it.
 *
 * Three triggers, and the visibility one is doing most of the work: a phone
 * app is backgrounded and reopened constantly, and each return is both the
 * best moment to ask whether a new build exists and the safest moment to take
 * one already waiting.
 */
function scheduleChecks(): void {
  window.setInterval(checkForUpdate, CHECK_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }

    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;

    /*
     * Applied without asking only after a real absence. Coming back to an app
     * left open in another tab is not the same as opening it again, and a
     * reload there discards whatever was on screen.
     */
    if (waiting && away >= AWAY_MS) {
      applyUpdate();
      return;
    }

    checkForUpdate();
  });

  // Coming back online is the other moment a check can suddenly succeed
  window.addEventListener('online', checkForUpdate);
}

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Vite serves modules unbundled in development, and a worker caching them
  // is a debugging session spent chasing a file that is not the file on disk
  if (import.meta.env.DEV) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Guarded because the event fires again on the reload it triggers
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      /*
       * `updateViaCache: 'none'` makes every update check a real request for
       * `sw.js` rather than one the HTTP cache may answer. The headers already
       * ask for revalidation, but a CDN or a proxy that ignores them would
       * otherwise pin a device to the worker it first saw — and a worker
       * decides how every other request is answered, so that pins the whole
       * app.
       */
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((target) => {
        watch(target);
        scheduleChecks();
      })
      .catch(() => {
        // An unregistrable worker costs the app nothing but offline support
      });
  });
}

/**
 * Which build is running, as stamped into `sw.js` at deploy time.
 *
 * Asked of the worker rather than baked into the bundle, so it reports what is
 * actually serving the page — which after an update that has not been taken
 * yet is not the same thing.
 */
export function currentVersion(): Promise<string | null> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => finish(null), 2000);

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'VERSION') finish(event.data.version ?? null);
    };

    function finish(version: string | null) {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve(version);
    }

    navigator.serviceWorker.addEventListener('message', onMessage);
    worker.postMessage('VERSION');
  });
}

/**
 * Removes the worker and everything it cached.
 *
 * The recovery path if a future worker ever does pin someone to a broken
 * deploy, and by then the broken deploy is what they would be running.
 */
export async function unregisterServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((entry) => entry.unregister()));

  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name.startsWith('nostrfeed-')).map((name) => caches.delete(name))
  );
}
