import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyUpdate, subscribeToUpdates } from '@/lib/serviceWorker';
import {
  subscribeToInstallPrompt,
  showInstallPrompt,
  type InstallEvent,
} from '@/lib/installPrompt';
import { installRoute } from '@/lib/install';
import { useStored } from '@/hooks/useStore';
import { defineKey } from '@/lib/store';
import { cn } from '@/lib/utils';

/**
 * Whether the install offer has been turned down.
 *
 * Persisted, because an offer that comes back every visit stops being an offer
 * and becomes an obstacle.
 */
const installDismissedKey = defineKey<boolean>('nostr:install-dismissed', false);

/**
 * A new version is ready, or the app can be installed.
 *
 * Both are the same shape of message — something is available, take it or
 * don't — so they share one strip at the bottom of the screen rather than
 * competing for attention as two different notifications.
 */
export function UpdatePrompt() {
  const [updateReady, setUpdateReady] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [iosOpen, setIosOpen] = useState(false);
  const [installDismissed, setInstallDismissed] = useStored(installDismissedKey);

  useEffect(() => subscribeToUpdates(setUpdateReady), []);

  /*
   * Subscribed to a listener attached back in `main.tsx`, not to the event
   * itself. Chrome fires `beforeinstallprompt` before React mounts on any
   * warm cache, so a listener added here would miss it and the strip would
   * never appear — which is exactly what used to happen.
   */
  useEffect(() => subscribeToInstallPrompt(setInstallEvent), []);

  // An update is the more urgent of the two: it may be the fix for whatever
  // brought them back
  if (updateReady) {
    return (
      <Strip
        title="A new version is ready"
        body="Reload to pick it up. Anything you've written is saved."
        action={
          <Button size="sm" onClick={applyUpdate}>
            <Download className="mr-2 h-3.5 w-3.5" />
            Reload
          </Button>
        }
      />
    );
  }

  if (installDismissed) return null;

  /**
   * Which offer to make, if any.
   *
   * `installRoute` is what brings iOS into this at all. Safari never fires
   * `beforeinstallprompt` — there is no programmatic install on an iPhone —
   * so a strip that waits for the event shows nothing there, forever, and
   * every iPhone visitor concludes the app cannot be installed on their
   * phone. The route says to show the Share-sheet steps instead.
   */
  const route = installRoute(!!installEvent);

  if (route === 'prompt') {
    return (
      <Strip
        title="Install NostrFeed"
        body="Opens like an app, and keeps working when the connection doesn't."
        action={
          <Button size="sm" onClick={() => void showInstallPrompt()}>
            Install
          </Button>
        }
        onDismiss={() => setInstallDismissed(true)}
      />
    );
  }

  if (route === 'ios-share') {
    return (
      <Strip
        title="Add NostrFeed to your Home Screen"
        body={
          iosOpen
            ? undefined
            : 'Opens like an app, full screen, and can send notifications.'
        }
        action={
          !iosOpen && (
            <Button size="sm" onClick={() => setIosOpen(true)}>
              How
            </Button>
          )
        }
        onDismiss={() => setInstallDismissed(true)}
      >
        {/*
          Spelled out rather than linked to settings. Somebody who has just
          been told the app can be installed will not go looking for a page
          about it, and the whole procedure is three taps.
        */}
        {iosOpen && (
          <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            <li className="flex items-center gap-2">
              <Share className="h-3.5 w-3.5 shrink-0 text-primary" />
              Tap Share, in the Safari toolbar
            </li>
            <li className="flex items-center gap-2">
              <SquarePlus className="h-3.5 w-3.5 shrink-0 text-primary" />
              Scroll down to “Add to Home Screen”
            </li>
            <li className="flex items-center gap-2">
              <span className="w-3.5 shrink-0 text-center text-primary">✓</span>
              Tap Add
            </li>
          </ol>
        )}
      </Strip>
    );
  }

  return null;
}

function Strip({
  title,
  body,
  action,
  onDismiss,
  children,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  onDismiss?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'fixed inset-x-3 z-50 mx-auto max-w-md rounded-xl border bg-card p-3 shadow-lg',
        /*
         * Above the tab bar on a phone, not over it. The bar is 4rem of
         * fixed-position navigation at the bottom of every screen, and a
         * strip at `bottom-3` covered the middle of it — so dismissing the
         * offer meant first tapping around it.
         */
        'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]',
        'sm:inset-x-auto sm:right-4 lg:bottom-4'
      )}
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          {body && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {body}
            </p>
          )}
          {children}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {action}
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              // 44px, like every other control that has to be hit on a phone
              className="h-11 w-11"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
