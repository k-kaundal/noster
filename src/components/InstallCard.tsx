import { useEffect, useState } from 'react';
import { Check, Download, Share, SquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { installRoute, type InstallRoute } from '@/lib/install';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Installing the app, wherever the reader happens to be.
 *
 * Lives in settings rather than only as the bottom strip, because the strip is
 * dismissible and dismissed once means gone forever — and somebody who now
 * wants notifications has a new reason to install that they did not have when
 * they waved it away.
 */
export function InstallCard() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (incoming: Event) => {
      incoming.preventDefault();
      setEvent(incoming as InstallEvent);
    };

    const onInstalled = () => {
      setEvent(null);
      setInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const route: InstallRoute = installed ? 'installed' : installRoute(!!event);

  if (route === 'none') return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="h-4 w-4" />
          Install the app
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {route === 'installed' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="h-4 w-4 text-success-strong" />
            Already installed. The unread count shows on the icon.
          </p>
        )}

        {route === 'prompt' && (
          <>
            <p className="text-sm text-muted-foreground">
              Opens in its own window, keeps working offline, and carries the
              unread count on its icon.
            </p>
            <Button
              onClick={async () => {
                await event?.prompt();
                /**
                 * Cleared either way. The event is single-use — the browser
                 * will not honour a second `prompt()` on it — so leaving the
                 * button live would produce one that silently does nothing.
                 */
                setEvent(null);
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Install
            </Button>
          </>
        )}

        {/*
          iOS has no programmatic install, so this is the only route — and
          without it iPhone users see nothing at all and conclude the app does
          not support their phone.
        */}
        {route === 'ios-share' && (
          <>
            <p className="text-sm text-muted-foreground">
              Safari installs from the Share menu rather than a button:
            </p>

            <ol className="space-y-2 text-sm">
              <li className="flex items-center gap-2.5">
                <Share className="h-4 w-4 shrink-0 text-primary" />
                Tap Share, at the bottom of the screen
              </li>
              <li className="flex items-center gap-2.5">
                <SquarePlus className="h-4 w-4 shrink-0 text-primary" />
                Scroll down and tap "Add to Home Screen"
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="h-4 w-4 shrink-0 text-primary" />
                Tap Add
              </li>
            </ol>

            <p className="text-xs text-muted-foreground">
              Notifications on iOS only work once the app has been added this
              way — Safari does not offer them to an ordinary tab.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
