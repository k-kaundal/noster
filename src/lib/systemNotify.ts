/**
 * System notifications and the app badge.
 *
 * What this can and cannot do is worth stating plainly, because the gap
 * between them is invisible from the UI and people reasonably expect the
 * larger thing.
 *
 * It **can** raise a system notification and set the icon badge while the app
 * is running — a tab open in the background, or the installed app not in
 * focus. That covers the case people actually complain about: sitting on
 * another tab and missing a reply.
 *
 * It **cannot** deliver anything when the app is fully closed. That is Web
 * Push, and Web Push needs a server: something has to hold a subscription,
 * watch the relays on the reader's behalf, and send the push. This app talks
 * to relays from the browser and has no backend to do that. Pretending
 * otherwise would ship a switch labelled "notifications" that silently does
 * nothing overnight, which is worse than not offering it.
 */

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissionState(): PermissionState {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission as PermissionState;
}

/**
 * Asks for permission, once.
 *
 * Only ever from a click. Browsers reject — and some permanently penalise — a
 * permission request that arrives without a user gesture, and a denial is not
 * a decision that can be asked again.
 */
export async function requestPermission(): Promise<PermissionState> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') {
    return Notification.permission as PermissionState;
  }

  try {
    return (await Notification.requestPermission()) as PermissionState;
  } catch {
    return permissionState();
  }
}

export interface SystemNotice {
  title: string;
  body: string;
  /** Where clicking it should land. */
  url: string;
  /**
   * Collapses repeats.
   *
   * Two notifications with one tag replace each other rather than stacking, so
   * a burst of zaps on one note is a single line that keeps updating instead
   * of twenty that have to be dismissed one at a time.
   */
  tag?: string;
  icon?: string;
}

/**
 * Shows a notification, if the reader is not already looking at the app.
 *
 * The visibility check is the whole politeness of the feature. A system
 * notification for something already on screen is noise, and it is the fastest
 * way to make somebody turn the whole thing off.
 */
export function showNotice(notice: SystemNotice): boolean {
  if (permissionState() !== 'granted') return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    return false;
  }

  try {
    const notification = new Notification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      icon: notice.icon ?? '/icon-192.png',
      badge: '/favicon-32.png',
    });

    notification.onclick = () => {
      /**
       * Focus the tab that already exists rather than opening another. Someone
       * who has the app open in a background tab does not want a second copy
       * of it.
       */
      window.focus();
      window.location.href = notice.url;
      notification.close();
    };

    return true;
  } catch {
    /**
     * Android requires notifications to come from the service worker
     * registration rather than the constructor, and throws here. Nothing to
     * recover — the badge below still works, and the in-app list is unchanged.
     */
    return false;
  }
}

/**
 * The count on the installed app's icon.
 *
 * Separate from notifications and worth having on its own: it needs no
 * permission prompt, it survives the app being closed on platforms that
 * support it, and it answers "is there anything waiting" without interrupting
 * anybody.
 */
export function badgingSupported(): boolean {
  return typeof navigator !== 'undefined' && 'setAppBadge' in navigator;
}

export function setBadge(count: number): void {
  // Declared by the DOM lib but absent on plenty of browsers, hence the check
  if (!badgingSupported()) return;

  /**
   * Cleared rather than set to zero. A badge showing "0" is a badge, and the
   * point of nothing being unread is that there is no badge.
   */
  const done =
    count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();

  // A rejected promise here is a platform declining, not an error to report
  void done.catch(() => undefined);
}
