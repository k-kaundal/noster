/**
 * Installing the app, on the three platforms that do it differently.
 *
 * Android and desktop Chromium fire `beforeinstallprompt`, which the app can
 * catch and re-offer at a sensible moment. iOS never fires it — Safari has no
 * programmatic install at all, and the only route is the Share sheet. That
 * asymmetry is invisible in code that only listens for the event: iOS users
 * simply never see an offer, and it looks like the app cannot be installed on
 * their phone.
 *
 * Sniffing the user agent is the wrong tool almost everywhere. Here it is the
 * only one: there is no feature to detect, because the feature is a menu item
 * in somebody else's browser.
 */

export type InstallRoute = 'prompt' | 'ios-share' | 'installed' | 'none';

/** Whether the page is already running as an installed app. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  /**
   * Two checks, because iOS predates the standard one. `navigator.standalone`
   * is Apple's own, still the only reliable answer on an iPhone.
   */
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches;
  const iosStandalone = (navigator as { standalone?: boolean }).standalone;

  return !!displayMode || !!iosStandalone;
}

/**
 * Whether this is an iPhone or iPad.
 *
 * iPadOS reports itself as a Mac, so the touch-point check is what tells a
 * modern iPad from a desktop Safari — without it, iPad users fall into the
 * "no install offer" gap this whole module exists to close.
 */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent;

  if (/iPad|iPhone|iPod/.test(ua)) return true;

  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * Whether this is Safari rather than another browser on iOS.
 *
 * On iOS every browser is Safari underneath, but only Safari itself has the
 * Add to Home Screen item — Chrome and Firefox on iOS cannot install at all,
 * so showing them the Share-sheet steps sends people looking for a menu entry
 * that is not there.
 */
export function isIosSafari(): boolean {
  if (!isIos()) return false;

  const ua = navigator.userAgent;

  // CriOS, FxiOS, EdgiOS and friends all identify themselves
  return !/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);
}

/** Which route to offer, given whether the browser has handed us a prompt. */
export function installRoute(hasPrompt: boolean): InstallRoute {
  if (isStandalone()) return 'installed';
  if (hasPrompt) return 'prompt';
  if (isIosSafari()) return 'ios-share';

  /**
   * Everything else: an iOS browser that cannot install, a desktop browser
   * that has not decided the site is installable yet, or one that never will.
   * Saying nothing beats inventing instructions for a menu that varies.
   */
  return 'none';
}
