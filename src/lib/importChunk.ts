const RELOAD_KEY = 'nostr:chunk-reloaded';

function hasReloaded(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_KEY) === '1';
  } catch {
    // Storage blocked; without the flag one reload per failure is still safe
    return false;
  }
}

function setReloaded(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(RELOAD_KEY, '1');
    else sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    // Nothing to remember, so the reload guard simply does not apply
  }
}

/**
 * Reloads the page to pick up the current build, at most once per session.
 *
 * A second reload would mean the chunk is missing for some reason a reload
 * cannot fix — a broken build, an offline device — and looping on that is
 * worse than the error, because it takes away even the ability to read the
 * message. The flag is cleared as soon as any chunk loads, so a later deploy
 * in the same session is still handled.
 */
function reloadForNewBuild(): void {
  if (hasReloaded()) return;

  setReloaded(true);
  window.location.reload();
}

/**
 * Recovers from chunks that a deploy replaced.
 *
 * Chunk filenames carry a content hash, so a deploy writes new ones and
 * deletes the old. A tab opened before it keeps asking for names the server no
 * longer has, and every dynamic import fails until the page is reloaded — the
 * app looks fine and then breaks on the first click.
 *
 * Vite reports this on `window` as `vite:preloadError`, which catches every
 * dynamic import in the bundle: routes, dialogs, and anything a dependency
 * loads on its own. Wrapping call sites by hand could never cover the last of
 * those, which is why this is the mechanism the rest is built around.
 *
 * The event is cancelable and Vite rethrows unless it is cancelled. Cancelling
 * keeps a failure we are already handling from also surfacing as a React
 * error, in the moment before the reload takes the page away.
 */
export function installChunkErrorHandler(): void {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadForNewBuild();
  });
}

/**
 * A dynamic import that survives a deploy.
 *
 * The retry costs one request and covers a chunk that was merely slow, or
 * briefly absent while a deploy was still uploading — worth trying before
 * throwing the page away, which is why route imports use this rather than
 * relying on the global handler alone.
 */
export async function importChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    const module = await load();

    // Vite resolves to undefined when the preload error was cancelled above.
    // Handing that to `lazy()` would read `.default` of nothing and report a
    // type error in place of the real one, so it waits for the reload instead.
    if (!module) return never<T>();

    setReloaded(false);
    return module;
  } catch (error) {
    try {
      const module = await load();
      if (!module) return never<T>();

      setReloaded(false);
      return module;
    } catch {
      // Nothing was cancelled on this path, so the reload is still ours to do
      if (hasReloaded()) throw error;

      reloadForNewBuild();
      return never<T>();
    }
  }
}

/** A promise that never settles, for when the document is being replaced. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}
