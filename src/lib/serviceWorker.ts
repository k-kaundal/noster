/**
 * Registers the service worker, and notices when a new one is waiting.
 *
 * The worker never takes over on its own — see the comment in `sw.js` about
 * why swapping under a running page breaks it. So the update has to be
 * offered: this reports a waiting worker, and activates it only when someone
 * says yes, reloading once it has control.
 */

type UpdateListener = (ready: boolean) => void;

const listeners = new Set<UpdateListener>();

let waiting: ServiceWorker | null = null;
let reloading = false;

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

function watch(registration: ServiceWorkerRegistration): void {
  // Already waiting when the page loaded — a tab opened after a deploy
  if (registration.waiting && navigator.serviceWorker.controller) {
    waiting = registration.waiting;
    announce();
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
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
        waiting = installing;
        announce();
      }
    });
  });
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
      .register('/sw.js', { scope: '/' })
      .then(watch)
      .catch(() => {
        // An unregistrable worker costs the app nothing but offline support
      });
  });
}

/**
 * Removes the worker and everything it cached.
 *
 * Not wired to anything, and deliberately kept: it is the recovery path if a
 * future worker ever does pin someone to a broken deploy, and by then the
 * broken deploy is what they would be running.
 */
export async function unregisterServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name.startsWith('nostrfeed-')).map((name) => caches.delete(name))
  );
}
