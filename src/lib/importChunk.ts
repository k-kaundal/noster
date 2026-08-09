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
 * A dynamic import that survives a deploy.
 *
 * Chunk filenames carry a content hash, so a deploy replaces them and a tab
 * opened before it asks for names the server no longer has. The import rejects
 * with "Failed to fetch dynamically imported module" and every route behind it
 * stays dead until the person reloads by hand — which nobody thinks to do,
 * because the app looks fine until they click.
 *
 * The retry covers a chunk that was merely slow, or briefly absent while the
 * upload was still in flight. The reload covers the real case: it fetches an
 * index.html naming the chunks that exist now. Reloading a second time would
 * mean the build itself is broken, so the flag stops there and lets the error
 * reach the boundary instead of looping.
 */
export async function importChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    const module = await load();
    setReloaded(false);
    return module;
  } catch (error) {
    try {
      const module = await load();
      setReloaded(false);
      return module;
    } catch {
      if (hasReloaded()) throw error;

      setReloaded(true);
      window.location.reload();

      // The document is being replaced, so this intentionally never settles
      return new Promise<T>(() => {});
    }
  }
}
