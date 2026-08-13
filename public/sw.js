/**
 * NostrFeed service worker.
 *
 * Hand-written rather than generated. A build plugin would precache a manifest
 * of hashed filenames, which is more than this needs and one more thing that
 * can ship a stale index.html — the failure mode where a returning visitor is
 * served yesterday's HTML pointing at chunks that no longer exist. Everything
 * here is runtime caching, and the rules are chosen so that can never happen:
 * HTML is always fetched from the network first, and only content-hashed
 * filenames are ever served from the cache without checking.
 *
 * No precache also means no install-time download: the app is cached as it is
 * used, so the first visit costs nothing extra.
 */

/**
 * This build's identity, replaced by `scripts/sw-version.mjs` after `vite
 * build` and left as the literal below in development.
 *
 * It is what makes an update detectable at all. A browser decides a worker is
 * new by comparing bytes, and this file's bytes never used to change between
 * deploys — so the "new version ready" path could not fire, no matter how much
 * of the app had changed underneath it. Stamping the build hash in here is one
 * byte-level difference per deploy, which is exactly the signal that machinery
 * was waiting for.
 */
const VERSION = '__BUILD_ID__';

const SHELL = `nostrfeed-shell-${VERSION}`;
const ASSETS = `nostrfeed-assets-${VERSION}`;
const IMAGES = `nostrfeed-images-${VERSION}`;

const CURRENT = new Set([SHELL, ASSETS, IMAGES]);

/** Images cached from other origins. Capped: a feed can reference thousands. */
const MAX_IMAGES = 200;

self.addEventListener('install', () => {
  // Deliberately not calling skipWaiting. A new worker taking over a page
  // that is already running means the running page can ask for chunks this
  // deploy no longer has. It waits, and the app offers a reload instead.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();

      await Promise.all(
        names
          .filter((name) => name.startsWith('nostrfeed-') && !CURRENT.has(name))
          .map((name) => caches.delete(name))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  /** The app asks for this when an update is accepted, or applied for them. */
  if (event.data === 'SKIP_WAITING') self.skipWaiting();

  /** Which build is answering, for the version shown in settings. */
  if (event.data === 'VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: VERSION });
  }
});

/** Keeps a cache from growing without limit, oldest entry first. */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  for (const key of keys.slice(0, Math.max(0, keys.length - max))) {
    await cache.delete(key);
  }
}

/**
 * HTML, always from the network when there is one.
 *
 * The cached copy exists for offline only. Serving it in preference to the
 * network is how a single-page app pins itself to an old deploy: the HTML
 * names the JavaScript, and stale HTML names files that have been replaced.
 */
async function networkFirst(request) {
  const cache = await caches.open(SHELL);

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Any route of a single-page app is served by the same document, so the
    // last one seen is a usable answer for a route never visited before
    const shell = await cache.match('/');
    if (shell) return shell;

    throw error;
  }
}

/**
 * Content-hashed files, straight from the cache.
 *
 * Safe precisely because the name contains a hash of the contents: a changed
 * file is a different URL, so a cache hit can never be out of date.
 */
async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);

  // Opaque cross-origin responses have no readable status; caching them
  // anyway is what makes an offline feed keep its pictures
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
    if (max) void trim(cacheName, max);
  }

  return response;
}

function isImage(request, url) {
  return (
    request.destination === 'image' ||
    /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only plain reads. A queued note being sent is a POST somewhere, and a
  // service worker has no business holding on to one.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const sameOrigin = url.origin === self.location.origin;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }

  if (isImage(request, url)) {
    event.respondWith(cacheFirst(request, IMAGES, MAX_IMAGES));
    return;
  }

  /**
   * Everything else goes straight to the network, uncached.
   *
   * That covers the wallet, the mint, relay NIP-11 documents and uploads —
   * requests whose answers are balances, quotes and one-time tokens. A cached
   * balance is a wrong balance, and there is no version of that which is
   * better than waiting.
   */
});
