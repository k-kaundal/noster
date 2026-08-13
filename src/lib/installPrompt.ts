/**
 * Holding on to the browser's install offer.
 *
 * `beforeinstallprompt` fires once, early, and is gone — Chrome dispatches it
 * as soon as it decides the site is installable, which on a warm cache is
 * before React has mounted and long before any `useEffect` has run. A listener
 * attached from a component therefore misses it on most visits, and the app
 * concludes it cannot be installed. That is why this module exists and why it
 * is imported for its side effect from `main.tsx`: the listener has to be
 * attached during the first script evaluation, ahead of everything else.
 *
 * The event is also single-use. Calling `prompt()` twice on one event does
 * nothing, silently, so it is cleared once spent rather than left behind a
 * button that no longer works.
 */

export interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Listener = (event: InstallEvent | null) => void;

const listeners = new Set<Listener>();

let captured: InstallEvent | null = null;
let installed = false;

function announce(): void {
  for (const listener of listeners) listener(captured);
}

/**
 * Watches for the offer and for the install itself.
 *
 * Safe to call more than once — the listeners are attached once, on the first
 * call, so an accidental second import cannot double-handle the event.
 */
let started = false;

export function watchInstallPrompt(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome shows its own bar otherwise, at a moment of its choosing
    event.preventDefault();
    captured = event as InstallEvent;
    announce();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    captured = null;
    announce();
  });
}

export function subscribeToInstallPrompt(listener: Listener): () => void {
  watchInstallPrompt();
  listener(captured);

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the app was installed during this session. */
export function wasInstalled(): boolean {
  return installed;
}

/**
 * Shows the browser's install dialog, and reports what was chosen.
 *
 * The event is discarded either way, spent or refused: a refused prompt cannot
 * be re-shown from the same event, and the browser will fire a fresh one when
 * it is willing to ask again.
 */
export async function showInstallPrompt(): Promise<boolean> {
  const event = captured;
  if (!event) return false;

  captured = null;
  announce();

  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === 'accepted';
  } catch {
    return false;
  }
}
