import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyUpdate, subscribeToUpdates } from '@/lib/serviceWorker';
import { useStored } from '@/hooks/useStore';
import { defineKey } from '@/lib/store';

/**
 * Whether the install offer has been turned down.
 *
 * Persisted, because an offer that comes back every visit stops being an offer
 * and becomes an obstacle.
 */
const installDismissedKey = defineKey<boolean>('nostr:install-dismissed', false);

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

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
  const [installDismissed, setInstallDismissed] = useStored(installDismissedKey);

  useEffect(() => subscribeToUpdates(setUpdateReady), []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Chrome shows its own bar otherwise, at a moment of its choosing
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
    };

    const onInstalled = () => setInstallEvent(null);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

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

  if (!installEvent || installDismissed) return null;

  return (
    <Strip
      title="Install NostrFeed"
      body="Opens like an app, and keeps working when the connection doesn't."
      action={
        <Button
          size="sm"
          onClick={async () => {
            await installEvent.prompt();
            await installEvent.userChoice;
            setInstallEvent(null);
          }}
        >
          Install
        </Button>
      }
      onDismiss={() => setInstallDismissed(true)}
    />
  );
}

function Strip({
  title,
  body,
  action,
  onDismiss,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border bg-card p-3 shadow-lg sm:inset-x-auto sm:right-4"
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {body}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {action}
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
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
